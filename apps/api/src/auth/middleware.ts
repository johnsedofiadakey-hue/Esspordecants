import type { MiddlewareHandler } from "hono";
import type { AdminUser, AppEnv, Deps } from "../context.ts";
import { COLLECTIONS } from "../firebase.ts";
import { ApiError } from "../lib/errors.ts";

export type AdminDoc = {
  email: string;
  name: string;
  role: AdminUser["role"];
  disabled: boolean;
  createdAt: string;
  lastLoginAt: string | null;
};

// Admins sign in with Firebase Auth in the browser and send the ID token as a
// bearer token. A valid token is not enough: the uid must also have an active
// record in the admins collection, so self-registered Firebase users get nothing.
export function requireAdmin(deps: Deps): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const header = c.req.header("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!token) throw new ApiError(401, "unauthenticated", "Sign in to continue.");
    let uid: string;
    try {
      uid = (await deps.store.auth.verifyIdToken(token, true)).uid;
    } catch {
      throw new ApiError(401, "unauthenticated", "Your session has expired. Sign in again.");
    }
    const snapshot = await deps.store.db.collection(COLLECTIONS.admins).doc(uid).get();
    const admin = snapshot.data() as AdminDoc | undefined;
    if (!admin || admin.disabled) throw new ApiError(403, "not_an_admin", "This account does not have admin access.");
    c.set("user", { id: uid, email: admin.email, name: admin.name, role: admin.role });
    await next();
  };
}

export function requireOwner(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (c.get("user").role !== "owner") throw new ApiError(403, "forbidden", "Only the store owner can do this.");
    await next();
  };
}
