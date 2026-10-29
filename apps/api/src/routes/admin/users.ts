import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv, Deps } from "../../context.ts";
import { requireOwner, type AdminDoc } from "../../auth/middleware.ts";
import { COLLECTIONS, type Store } from "../../firebase.ts";
import { badRequest, conflict, notFound } from "../../lib/errors.ts";
import { now } from "../../lib/util.ts";
import { readJson, shortText } from "../../lib/validate.ts";
import { audit } from "../../services/audit.ts";

export const MIN_PASSWORD_LENGTH = 12;

export const passwordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters.`)
  .max(200);

const createBody = z.object({
  email: z.email().max(200).transform((value) => value.toLowerCase()),
  name: shortText(120).min(1),
  role: z.enum(["owner", "editor"]),
  password: passwordSchema,
});

const patchBody = z.object({
  name: shortText(120).min(1).optional(),
  role: z.enum(["owner", "editor"]).optional(),
  disabled: z.boolean().optional(),
});

const toUser = (id: string, doc: AdminDoc) => ({
  id,
  email: doc.email,
  name: doc.name,
  role: doc.role,
  disabled: doc.disabled,
  createdAt: doc.createdAt,
  lastLoginAt: doc.lastLoginAt,
});

// Creates the Firebase Auth account and its admin record. Used by the API and the CLI.
export async function createAdmin(store: Store, input: z.infer<typeof createBody>) {
  let uid: string;
  try {
    uid = (await store.auth.createUser({ email: input.email, password: input.password, displayName: input.name })).uid;
  } catch (error) {
    if ((error as { code?: string }).code === "auth/email-already-exists") {
      throw conflict("email_taken", "An account with that email already exists.");
    }
    throw error;
  }
  const doc: AdminDoc = { email: input.email, name: input.name, role: input.role, disabled: false, createdAt: now(), lastLoginAt: null };
  await store.db.collection(COLLECTIONS.admins).doc(uid).set(doc);
  return { id: uid, doc };
}

export function userRoutes(deps: Deps) {
  const { store } = deps;
  const admins = store.db.collection(COLLECTIONS.admins);
  const app = new Hono<AppEnv>();

  // Records the sign-in time; the admin calls this once after signing in.
  app.get("/auth/me", async (c) => {
    const user = c.get("user");
    await admins.doc(user.id).update({ lastLoginAt: now() });
    return c.json({ user });
  });

  app.use("/users", requireOwner());
  app.use("/users/*", requireOwner());

  app.get("/users", async (c) => {
    const items = (await admins.get()).docs
      .map((doc) => toUser(doc.id, doc.data() as AdminDoc))
      .sort((a, b) => Number(a.disabled) - Number(b.disabled) || b.role.localeCompare(a.role) || a.name.localeCompare(b.name));
    return c.json({ items });
  });

  app.post("/users", async (c) => {
    const input = await readJson(c, createBody);
    const { id, doc } = await createAdmin(store, input);
    await audit(store, c.get("user").id, "create", "admin_user", id, { email: input.email, role: input.role });
    return c.json(toUser(id, doc), 201);
  });

  app.patch("/users/:id", async (c) => {
    const id = c.req.param("id");
    const input = await readJson(c, patchBody);
    const actor = c.get("user");
    if (id === actor.id && (input.disabled || input.role === "editor")) {
      throw badRequest("You cannot disable or demote your own account.");
    }
    const doc = await store.db.runTransaction(async (tx) => {
      const snapshot = await tx.get(admins.doc(id));
      if (!snapshot.exists) throw notFound("User");
      const owners = await tx.get(admins.where("role", "==", "owner").where("disabled", "==", false));
      const doc = { ...(snapshot.data() as AdminDoc) };
      if (input.name !== undefined) doc.name = input.name;
      if (input.role !== undefined) doc.role = input.role;
      if (input.disabled !== undefined) doc.disabled = input.disabled;
      const remaining = owners.docs.filter((owner) => owner.id !== id).length + (doc.role === "owner" && !doc.disabled ? 1 : 0);
      if (remaining === 0) throw conflict("last_owner", "At least one active owner is required.");
      tx.set(admins.doc(id), doc);
      return doc;
    });
    if (input.disabled !== undefined) {
      await store.auth.updateUser(id, { disabled: input.disabled });
      if (input.disabled) await store.auth.revokeRefreshTokens(id);
    }
    if (input.name !== undefined) await store.auth.updateUser(id, { displayName: input.name });
    await audit(store, actor.id, "update", "admin_user", id, { fields: Object.keys(input) });
    return c.json(toUser(id, doc));
  });

  // Owner-initiated reset, e.g. for a forgotten password. Signs the user out everywhere.
  app.post("/users/:id/password", async (c) => {
    const id = c.req.param("id");
    const { password } = await readJson(c, z.object({ password: passwordSchema }));
    const snapshot = await admins.doc(id).get();
    if (!snapshot.exists) throw notFound("User");
    await store.auth.updateUser(id, { password });
    await store.auth.revokeRefreshTokens(id);
    await audit(store, c.get("user").id, "reset_password", "admin_user", id);
    return c.json({ ok: true });
  });

  return app;
}
