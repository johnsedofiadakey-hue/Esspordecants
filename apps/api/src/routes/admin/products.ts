import { Hono, type Context } from "hono";
import { z } from "zod";
import type { AppEnv, Deps } from "../../context.ts";
import { COLLECTIONS } from "../../firebase.ts";
import { ApiError, badRequest, conflict, notFound } from "../../lib/errors.ts";
import { fold, newId, now, slugify } from "../../lib/util.ts";
import { longText, noteList, parse, readJson, shortText, slugSchema } from "../../lib/validate.ts";
import { audit } from "../../services/audit.ts";
import {
  approvalProblems,
  deleteImageFile,
  IMAGE_ROLES,
  MEDIA_FILE,
  MEDIA_TYPES,
  readImageFile,
  uploadImage,
  type ImageRec,
  type ImageRole,
} from "../../services/images.ts";
import { applyStock, recordStock } from "../../services/orders.ts";
import {
  adminImage,
  adminProduct,
  adminProductSummary,
  adminVariant,
  assertUniqueSkus,
  assertUniqueSlug,
  emptyProduct,
  finalize,
  getProduct,
  isPublishable,
  mutateProduct,
  publishReadiness,
  uniqueSlug,
  type ProductDoc,
  type VariantRec,
} from "../../services/products.ts";
import { refreshContentForImage } from "./content.ts";

const productFields = z.object({
  slug: slugSchema,
  house: shortText(120),
  name: shortText(160),
  concentration: shortText(60),
  family: shortText(60),
  shortDescription: shortText(280),
  description: longText(6000),
  notes: z.object({ top: noteList, heart: noteList, base: noteList }),
  sourceBrand: shortText(160),
  authenticityCopy: longText(2000),
  whatArrives: longText(2000),
  copyApproved: z.boolean(),
  physical: z.object({
    bottleMaterial: shortText(120),
    capType: shortText(120),
    labelVersion: shortText(120),
    packagingNotes: longText(1000),
  }),
});

const productCreate = productFields.partial().extend({
  house: shortText(120).min(1, "House is required."),
  name: shortText(160).min(1, "Name is required."),
});
const productPatch = productFields.partial().extend({ physical: productFields.shape.physical.partial().optional() });

const variantFields = z.object({
  sku: z
    .string()
    .trim()
    .min(3)
    .max(40)
    .regex(/^[A-Za-z0-9-]+$/, "Use letters, numbers and hyphens.")
    .transform((value) => value.toUpperCase()),
  sizeMl: z.number().positive().max(200),
  priceMinor: z.number().int().min(0).max(100_000_000),
  stockQuantity: z.number().int().min(0).max(100_000),
  lowStockThreshold: z.number().int().min(0).max(1000),
  active: z.boolean(),
  bottleDiffers: z.boolean(),
  imageId: z.string().max(64).nullable(),
  packagingNotes: longText(1000),
  sortOrder: z.number().int().min(0).max(1000),
});

const imagePatch = z.object({
  role: z.enum(IMAGE_ROLES).optional(),
  alt: shortText(250).optional(),
  isRealPhoto: z.boolean().optional(),
  approved: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(1000).optional(),
});

const stockBody = z.object({
  delta: z
    .number()
    .int()
    .min(-100_000)
    .max(100_000)
    .refine((value) => value !== 0, "Change must not be zero."),
  reason: shortText(200).min(2, "Give a reason for the stock change."),
});

function applyPatch(product: ProductDoc, input: z.infer<typeof productPatch>) {
  const { physical, ...rest } = input;
  for (const [key, value] of Object.entries(rest)) {
    if (value !== undefined) (product as Record<string, unknown>)[key] = value;
  }
  if (physical) product.physical = { ...product.physical, ...Object.fromEntries(Object.entries(physical).filter(([, value]) => value !== undefined)) };
}

function findVariant(product: ProductDoc, variantId: string): VariantRec {
  const variant = product.variants.find((entry) => entry.id === variantId);
  if (!variant) throw notFound("Variant");
  return variant;
}

function findImage(product: ProductDoc, imageId: string): ImageRec {
  const image = product.images.find((entry) => entry.id === imageId);
  if (!image) throw notFound("Image");
  return image;
}

function assertVariantImage(product: ProductDoc, imageId: string | null | undefined) {
  if (imageId && !product.images.some((image) => image.id === imageId)) {
    throw badRequest("Variant image must belong to the same product.");
  }
}

// Variant and image ids are scoped to a product, so routes carry both ids.
async function readUpload(c: Context<AppEnv>, maxBytes: number) {
  let body: Record<string, unknown>;
  try {
    body = await c.req.parseBody();
  } catch {
    throw badRequest("Send the image as multipart/form-data.");
  }
  const file = body.file;
  if (!(file instanceof File)) throw badRequest("Attach an image file in the “file” field.");
  if (file.size > maxBytes) throw new ApiError(413, "file_too_large", `Images must be under ${Math.round(maxBytes / 1024 / 1024)} MB.`);
  const role = parse(z.enum(IMAGE_ROLES), body.role ?? "decant-front") as ImageRole;
  const alt = parse(shortText(250), body.alt ?? "");
  const isRealPhoto = body.isRealPhoto === "true";
  return { data: Buffer.from(await file.arrayBuffer()), originalName: file.name, role, alt, isRealPhoto };
}

export function productRoutes(deps: Deps) {
  const { store, config } = deps;
  const products = store.db.collection(COLLECTIONS.products);
  const app = new Hono<AppEnv>();

  // ----- Products -----

  app.get("/products", async (c) => {
    const status = c.req.query("status");
    const q = fold(c.req.query("q")?.trim() ?? "");
    const query = status && ["draft", "published", "archived"].includes(status) ? products.where("status", "==", status) : products;
    const items = (await query.get()).docs
      .map((doc) => ({ id: doc.id, ...(doc.data() as ProductDoc) }))
      .filter((product) => !q || fold(`${product.house} ${product.name} ${product.slug}`).includes(q))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return c.json({ items: items.map(adminProductSummary) });
  });

  app.post("/products", async (c) => {
    const input = await readJson(c, productCreate);
    const user = c.get("user");
    const slug = input.slug ?? (await uniqueSlug(store, slugify(`${input.house} ${input.name}`)));
    const id = newId();
    await store.db.runTransaction(async (tx) => {
      await assertUniqueSlug(store, slug, null, tx);
      const product = emptyProduct(input.house, input.name, slug);
      applyPatch(product, { ...input, slug: undefined, house: undefined, name: undefined });
      tx.set(products.doc(id), finalize(product));
    });
    await audit(store, user.id, "create", "product", id, { slug });
    return c.json(adminProduct(await getProduct(store, id)), 201);
  });

  app.get("/products/:id", async (c) => c.json(adminProduct(await getProduct(store, c.req.param("id")))));

  app.patch("/products/:id", async (c) => {
    const id = c.req.param("id");
    const input = await readJson(c, productPatch);
    const { product } = await mutateProduct(store, id, async (product, tx) => {
      if (input.slug && input.slug !== product.slug) await assertUniqueSlug(store, input.slug, id, tx);
      applyPatch(product, input);
    });
    await audit(store, c.get("user").id, "update", "product", id, { fields: Object.keys(input) });
    return c.json(adminProduct(product));
  });

  app.post("/products/:id/publish", async (c) => {
    const id = c.req.param("id");
    const { product } = await mutateProduct(store, id, (product) => {
      if (product.status === "published") return;
      const readiness = publishReadiness(product);
      if (!isPublishable(readiness)) {
        throw new ApiError(422, "publish_gate_failed", "This product is not ready to publish.", readiness.filter((check) => !check.ok));
      }
      product.status = "published";
      product.publishedAt = now();
    });
    await audit(store, c.get("user").id, "publish", "product", id);
    return c.json(adminProduct(product));
  });

  for (const [action, status] of [
    ["unpublish", "draft"],
    ["archive", "archived"],
    ["restore", "draft"],
  ] as const) {
    app.post(`/products/:id/${action}`, async (c) => {
      const id = c.req.param("id");
      const { product } = await mutateProduct(store, id, (product) => {
        product.status = status;
      });
      await audit(store, c.get("user").id, action, "product", id);
      return c.json(adminProduct(product));
    });
  }

  app.delete("/products/:id", async (c) => {
    const id = c.req.param("id");
    const product = await getProduct(store, id);
    if (product.status === "published") throw conflict("product_has_status", "Unpublish the product before deleting it.");
    const ordered = await store.db.collection(COLLECTIONS.orders).where("productIds", "array-contains", id).limit(1).get();
    if (!ordered.empty) throw conflict("product_has_orders", "This product appears in orders. Archive it instead.");
    await products.doc(id).delete();
    await Promise.all(product.images.map((image) => deleteImageFile(store.bucket, image.fileName)));
    await audit(store, c.get("user").id, "delete", "product", id, { slug: product.slug });
    return c.json({ ok: true });
  });

  // ----- Variants -----

  app.post("/products/:id/variants", async (c) => {
    const productId = c.req.param("id");
    const input = await readJson(c, variantFields.partial().extend({ sku: variantFields.shape.sku, sizeMl: variantFields.shape.sizeMl }));
    const user = c.get("user");
    const variant: VariantRec = {
      id: newId(),
      sku: input.sku,
      sizeMl: input.sizeMl,
      priceMinor: input.priceMinor ?? 0,
      stockQuantity: input.stockQuantity ?? 0,
      lowStockThreshold: input.lowStockThreshold ?? 3,
      active: input.active ?? true,
      bottleDiffers: input.bottleDiffers ?? false,
      imageId: input.imageId ?? null,
      packagingNotes: input.packagingNotes ?? "",
      sortOrder: input.sortOrder ?? 0,
    };
    await mutateProduct(store, productId, async (product, tx) => {
      await assertUniqueSkus(store, productId, [...product.skus, variant.sku], tx);
      assertVariantImage(product, variant.imageId);
      product.variants.push(variant);
      if (variant.stockQuantity) {
        recordStock(store, tx, { variantId: variant.id, productId, delta: variant.stockQuantity, reason: "initial stock", orderId: null, actorUserId: user.id });
      }
    });
    await audit(store, user.id, "create", "variant", variant.id, { productId, sku: variant.sku });
    return c.json(adminVariant(variant, productId), 201);
  });

  // Stock is changed only through /stock so every change is logged with a reason.
  app.patch("/products/:id/variants/:variantId", async (c) => {
    const { id: productId, variantId } = c.req.param();
    const input = await readJson(c, variantFields.omit({ stockQuantity: true }).partial());
    const { result } = await mutateProduct(store, productId, async (product, tx) => {
      const variant = findVariant(product, variantId);
      if (input.sku && input.sku !== variant.sku) {
        await assertUniqueSkus(store, productId, product.variants.map((entry) => (entry.id === variantId ? input.sku! : entry.sku)), tx);
      }
      assertVariantImage(product, input.imageId);
      for (const [key, value] of Object.entries(input)) {
        if (value !== undefined) (variant as Record<string, unknown>)[key] = value;
      }
      return variant;
    });
    await audit(store, c.get("user").id, "update", "variant", variantId, { fields: Object.keys(input) });
    return c.json(adminVariant(result, productId));
  });

  app.post("/products/:id/variants/:variantId/stock", async (c) => {
    const { id: productId, variantId } = c.req.param();
    const input = await readJson(c, stockBody);
    const user = c.get("user");
    const { result } = await mutateProduct(store, productId, (product, tx) => {
      const variant = findVariant(product, variantId);
      if (variant.stockQuantity + input.delta < 0) throw badRequest(`Stock cannot go below zero (currently ${variant.stockQuantity}).`);
      applyStock(product, variantId, input.delta);
      recordStock(store, tx, { variantId, productId, delta: input.delta, reason: input.reason, orderId: null, actorUserId: user.id });
      return variant;
    });
    await audit(store, user.id, "stock", "variant", variantId, input);
    return c.json(adminVariant(result, productId));
  });

  app.get("/products/:id/variants/:variantId/stock", async (c) => {
    const { variantId } = c.req.param();
    const snapshot = await store.db.collection(COLLECTIONS.stock).where("variantId", "==", variantId).get();
    const admins = new Map((await store.db.collection(COLLECTIONS.admins).get()).docs.map((doc) => [doc.id, doc.data().name as string]));
    const items = snapshot.docs
      .map((doc) => doc.data())
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, 100)
      .map((row) => ({ delta: row.delta, reason: row.reason, orderId: row.orderId, createdAt: row.createdAt, actor: row.actorUserId ? (admins.get(row.actorUserId) ?? null) : null }));
    return c.json({ items });
  });

  app.delete("/products/:id/variants/:variantId", async (c) => {
    const { id: productId, variantId } = c.req.param();
    const ordered = await store.db.collection(COLLECTIONS.orders).where("variantIds", "array-contains", variantId).limit(1).get();
    if (!ordered.empty) throw conflict("variant_has_orders", "This size appears in orders. Deactivate it instead.");
    const { result: sku } = await mutateProduct(store, productId, (product) => {
      const variant = findVariant(product, variantId);
      product.variants = product.variants.filter((entry) => entry.id !== variantId);
      return variant.sku;
    });
    await audit(store, c.get("user").id, "delete", "variant", variantId, { sku });
    return c.json({ ok: true });
  });

  // ----- Product images -----

  app.post("/products/:id/images", async (c) => {
    const productId = c.req.param("id");
    const current = await getProduct(store, productId);
    const upload = await readUpload(c, config.maxUploadBytes);
    const sortOrder = current.images.reduce((max, image) => Math.max(max, image.sortOrder + 1), 0);
    const image = await uploadImage(store.bucket, upload, sortOrder);
    try {
      await mutateProduct(store, productId, (product) => {
        product.images.push(image);
      });
    } catch (error) {
      await deleteImageFile(store.bucket, image.fileName);
      throw error;
    }
    await audit(store, c.get("user").id, "upload", "image", image.id, { productId, role: image.role });
    return c.json(adminImage(image, productId), 201);
  });

  app.patch("/products/:id/images/:imageId", async (c) => {
    const { id: productId, imageId } = c.req.param();
    const input = await readJson(c, imagePatch);
    const { result } = await mutateProduct(store, productId, (product) => {
      const image = findImage(product, imageId);
      const next: ImageRec = {
        ...image,
        role: input.role ?? image.role,
        alt: input.alt ?? image.alt,
        isRealPhoto: input.isRealPhoto ?? image.isRealPhoto,
        approved: input.approved ?? image.approved,
        sortOrder: input.sortOrder ?? image.sortOrder,
      };
      if (next.approved) {
        const problems = approvalProblems(next);
        if (problems.length) throw new ApiError(422, "image_not_approvable", problems.join(" "), problems);
      }
      Object.assign(image, next);
      return image;
    });
    await audit(store, c.get("user").id, "update", "image", imageId, { fields: Object.keys(input) });
    return c.json(adminImage(result, productId));
  });

  app.delete("/products/:id/images/:imageId", async (c) => {
    const { id: productId, imageId } = c.req.param();
    const { result: fileName } = await mutateProduct(store, productId, (product) => {
      const image = findImage(product, imageId);
      product.images = product.images.filter((entry) => entry.id !== imageId);
      for (const variant of product.variants) if (variant.imageId === imageId) variant.imageId = null;
      return image.fileName;
    });
    await deleteImageFile(store.bucket, fileName);
    await audit(store, c.get("user").id, "delete", "image", imageId);
    return c.json({ ok: true });
  });

  // ----- Editorial image library -----

  const library = store.db.collection(COLLECTIONS.library);

  app.post("/images", async (c) => {
    const upload = await readUpload(c, config.maxUploadBytes);
    const image = await uploadImage(store.bucket, { ...upload, role: "editorial" }, 0);
    await library.doc(image.id).set(image);
    await audit(store, c.get("user").id, "upload", "image", image.id, { role: "editorial" });
    return c.json(adminImage(image, null), 201);
  });

  app.get("/images", async (c) => {
    const items = (await library.get()).docs.map((doc) => doc.data() as ImageRec).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return c.json({ items: items.map((image) => adminImage(image, null)) });
  });

  app.patch("/images/:imageId", async (c) => {
    const imageId = c.req.param("imageId");
    const input = await readJson(c, imagePatch);
    if (input.role && input.role !== "editorial") throw badRequest("Library images must use the editorial role.");
    const image = await store.db.runTransaction(async (tx) => {
      const snapshot = await tx.get(library.doc(imageId));
      if (!snapshot.exists) throw notFound("Image");
      const image = { ...(snapshot.data() as ImageRec), ...Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) } as ImageRec;
      if (image.approved) {
        const problems = approvalProblems(image);
        if (problems.length) throw new ApiError(422, "image_not_approvable", problems.join(" "), problems);
      }
      tx.set(library.doc(imageId), image);
      return image;
    });
    await refreshContentForImage(store, imageId);
    await audit(store, c.get("user").id, "update", "image", imageId, { fields: Object.keys(input) });
    return c.json(adminImage(image, null));
  });

  app.delete("/images/:imageId", async (c) => {
    const imageId = c.req.param("imageId");
    const snapshot = await library.doc(imageId).get();
    if (!snapshot.exists) throw notFound("Image");
    const used = await store.db.collection(COLLECTIONS.content).where("imageId", "==", imageId).limit(1).get();
    if (!used.empty) throw conflict("image_in_use", "This image is used by a content entry. Remove it there first.");
    await library.doc(imageId).delete();
    await deleteImageFile(store.bucket, (snapshot.data() as ImageRec).fileName);
    await audit(store, c.get("user").id, "delete", "image", imageId);
    return c.json({ ok: true });
  });

  // Draft previews for the admin. The admin fetches these with its bearer token.
  app.get("/media/:file", async (c) => {
    const file = c.req.param("file");
    if (!MEDIA_FILE.test(file)) throw notFound("Image");
    const data = await readImageFile(store.bucket, file);
    if (!data) throw notFound("Image");
    return c.body(new Uint8Array(data), 200, {
      "Content-Type": MEDIA_TYPES[file.split(".").pop()!] ?? "application/octet-stream",
      "Cache-Control": "private, max-age=300",
    });
  });

  return app;
}
