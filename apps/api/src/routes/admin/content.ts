import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv, Deps } from "../../context.ts";
import { COLLECTIONS, type Store } from "../../firebase.ts";
import { ApiError, badRequest, conflict, notFound } from "../../lib/errors.ts";
import { newId, now } from "../../lib/util.ts";
import { longText, readJson, shortText, slugSchema } from "../../lib/validate.ts";
import { audit } from "../../services/audit.ts";
import type { ImageRec } from "../../services/images.ts";
import { adminImage } from "../../services/products.ts";

export type ContentDoc = {
  slug: string;
  placement: string;
  status: "draft" | "published";
  eyebrow: string;
  title: string;
  body: string;
  ctaLabel: string;
  ctaHref: string;
  imageId: string | null;
  // Copy of the library image, refreshed whenever the entry or image changes.
  image: ImageRec | null;
  publicFiles: string[];
  sortOrder: number;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

// Known storefront slots. Free-form placements are allowed for new pages.
export const CONTENT_PLACEMENTS = ["home-hero", "home-story", "home-feature", "announcement", "page"] as const;

const contentFields = z.object({
  slug: slugSchema,
  placement: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9-]+$/, "Use lowercase letters, numbers and hyphens."),
  eyebrow: shortText(80),
  title: shortText(200),
  body: longText(20000),
  ctaLabel: shortText(60),
  ctaHref: z
    .string()
    .trim()
    .max(300)
    .refine((value) => value === "" || value.startsWith("/") || /^https:\/\//.test(value), "Use a site path (/shop) or an https:// link."),
  imageId: z.string().max(64).nullable(),
  sortOrder: z.number().int().min(0).max(1000),
});

function finalizeContent(entry: ContentDoc): ContentDoc {
  entry.publicFiles = entry.status === "published" && entry.image?.approved ? [entry.image.fileName] : [];
  return entry;
}

function publishProblems(entry: ContentDoc): string[] {
  const problems: string[] = [];
  if (!entry.title.trim()) problems.push("Add a title.");
  if (!entry.body.trim() && entry.placement !== "home-hero") problems.push("Add body copy.");
  if (entry.ctaLabel.trim() && !entry.ctaHref.trim()) problems.push("Add a link for the call to action.");
  if (entry.image && !entry.image.approved) problems.push("Approve the attached image first.");
  return problems;
}

async function libraryImage(store: Store, imageId: string | null): Promise<ImageRec | null> {
  if (!imageId) return null;
  const snapshot = await store.db.collection(COLLECTIONS.library).doc(imageId).get();
  if (!snapshot.exists) throw badRequest("Image not found.");
  return snapshot.data() as ImageRec;
}

// Called after a library image changes so entries using it pick up the new state.
export async function refreshContentForImage(store: Store, imageId: string) {
  const image = await libraryImage(store, imageId);
  const snapshot = await store.db.collection(COLLECTIONS.content).where("imageId", "==", imageId).get();
  await Promise.all(
    snapshot.docs.map((doc) => doc.ref.set(finalizeContent({ ...(doc.data() as ContentDoc), image }))),
  );
}

function adminContent(id: string, entry: ContentDoc) {
  return {
    id,
    slug: entry.slug,
    placement: entry.placement,
    status: entry.status,
    eyebrow: entry.eyebrow,
    title: entry.title,
    body: entry.body,
    ctaLabel: entry.ctaLabel,
    ctaHref: entry.ctaHref,
    imageId: entry.imageId,
    image: entry.image ? adminImage(entry.image, null) : null,
    sortOrder: entry.sortOrder,
    publishedAt: entry.publishedAt,
    updatedAt: entry.updatedAt,
  };
}

export function publicContent(baseUrl: string, entry: ContentDoc) {
  const image = entry.image;
  return {
    slug: entry.slug,
    placement: entry.placement,
    eyebrow: entry.eyebrow,
    title: entry.title,
    body: entry.body,
    cta: entry.ctaLabel && entry.ctaHref ? { label: entry.ctaLabel, href: entry.ctaHref } : null,
    image: image?.approved ? { url: `${baseUrl}/media/${image.fileName}`, alt: image.alt, role: image.role } : null,
    updatedAt: entry.updatedAt,
  };
}

export function contentRoutes(deps: Deps) {
  const { store } = deps;
  const content = store.db.collection(COLLECTIONS.content);
  const app = new Hono<AppEnv>();

  async function getEntry(id: string): Promise<ContentDoc> {
    const snapshot = await content.doc(id).get();
    if (!snapshot.exists) throw notFound("Content entry");
    return snapshot.data() as ContentDoc;
  }

  async function assertSlugFree(slug: string, exceptId: string | null) {
    const snapshot = await content.where("slug", "==", slug).limit(2).get();
    if (snapshot.docs.some((doc) => doc.id !== exceptId)) throw conflict("slug_taken", "That slug is already in use.");
  }

  app.get("/content", async (c) => {
    const items = (await content.get()).docs
      .map((doc) => adminContent(doc.id, doc.data() as ContentDoc))
      .sort((a, b) => a.placement.localeCompare(b.placement) || a.sortOrder - b.sortOrder || a.title.localeCompare(b.title));
    return c.json({ items, placements: CONTENT_PLACEMENTS });
  });

  app.get("/content/:id", async (c) => c.json(adminContent(c.req.param("id"), await getEntry(c.req.param("id")))));

  app.post("/content", async (c) => {
    const input = await readJson(c, contentFields.partial().extend({ slug: slugSchema, placement: contentFields.shape.placement }));
    await assertSlugFree(input.slug, null);
    const timestamp = now();
    const entry: ContentDoc = {
      slug: input.slug,
      placement: input.placement,
      status: "draft",
      eyebrow: input.eyebrow ?? "",
      title: input.title ?? "",
      body: input.body ?? "",
      ctaLabel: input.ctaLabel ?? "",
      ctaHref: input.ctaHref ?? "",
      imageId: input.imageId ?? null,
      image: await libraryImage(store, input.imageId ?? null),
      publicFiles: [],
      sortOrder: input.sortOrder ?? 0,
      publishedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const id = newId();
    await content.doc(id).set(finalizeContent(entry));
    await audit(store, c.get("user").id, "create", "content", id, { slug: input.slug });
    return c.json(adminContent(id, entry), 201);
  });

  app.patch("/content/:id", async (c) => {
    const id = c.req.param("id");
    const input = await readJson(c, contentFields.partial());
    const entry = await getEntry(id);
    if (input.slug && input.slug !== entry.slug) await assertSlugFree(input.slug, id);
    for (const [key, value] of Object.entries(input)) {
      if (value !== undefined) (entry as Record<string, unknown>)[key] = value;
    }
    if (input.imageId !== undefined) entry.image = await libraryImage(store, input.imageId);
    if (entry.status === "published") {
      const problems = publishProblems(entry);
      if (problems.length) throw new ApiError(422, "publish_gate_failed", problems.join(" "), problems);
    }
    entry.updatedAt = now();
    await content.doc(id).set(finalizeContent(entry));
    await audit(store, c.get("user").id, "update", "content", id, { fields: Object.keys(input) });
    return c.json(adminContent(id, entry));
  });

  app.post("/content/:id/publish", async (c) => {
    const id = c.req.param("id");
    const entry = await getEntry(id);
    entry.image = await libraryImage(store, entry.imageId).catch(() => null);
    const problems = publishProblems(entry);
    if (problems.length) throw new ApiError(422, "publish_gate_failed", problems.join(" "), problems);
    entry.status = "published";
    entry.publishedAt = now();
    entry.updatedAt = now();
    await content.doc(id).set(finalizeContent(entry));
    await audit(store, c.get("user").id, "publish", "content", id);
    return c.json(adminContent(id, entry));
  });

  app.post("/content/:id/unpublish", async (c) => {
    const id = c.req.param("id");
    const entry = await getEntry(id);
    entry.status = "draft";
    entry.updatedAt = now();
    await content.doc(id).set(finalizeContent(entry));
    await audit(store, c.get("user").id, "unpublish", "content", id);
    return c.json(adminContent(id, entry));
  });

  app.delete("/content/:id", async (c) => {
    const id = c.req.param("id");
    const entry = await getEntry(id);
    if (entry.status === "published") throw conflict("content_published", "Unpublish this entry before deleting it.");
    await content.doc(id).delete();
    await audit(store, c.get("user").id, "delete", "content", id, { slug: entry.slug });
    return c.json({ ok: true });
  });

  return app;
}
