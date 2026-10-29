import type { Transaction } from "firebase-admin/firestore";
import { COLLECTIONS, type Store } from "../firebase.ts";
import { ApiError, conflict, notFound } from "../lib/errors.ts";
import { now } from "../lib/util.ts";
import { approvalProblems, sortImages, type ImageRec, type ImageRole } from "./images.ts";

export type ProductStatus = "draft" | "published" | "archived";

export type VariantRec = {
  id: string;
  sku: string;
  sizeMl: number;
  priceMinor: number;
  stockQuantity: number;
  lowStockThreshold: number;
  active: boolean;
  bottleDiffers: boolean;
  imageId: string | null;
  packagingNotes: string;
  sortOrder: number;
};

// One Firestore document per product. Variants and images are embedded so a
// product, its sizes and its photos are always read and written together.
export type ProductDoc = {
  slug: string;
  status: ProductStatus;
  house: string;
  name: string;
  concentration: string;
  family: string;
  shortDescription: string;
  description: string;
  notes: { top: string[]; heart: string[]; base: string[] };
  sourceBrand: string;
  authenticityCopy: string;
  whatArrives: string;
  copyApproved: boolean;
  physical: { bottleMaterial: string; capType: string; labelVersion: string; packagingNotes: string };
  isSample: boolean;
  images: ImageRec[];
  variants: VariantRec[];
  // Derived on every write (see finalize): used for queries.
  variantIds: string[];
  skus: string[];
  publicFiles: string[];
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Product = ProductDoc & { id: string };

export function emptyProduct(house: string, name: string, slug: string): ProductDoc {
  const timestamp = now();
  return {
    slug,
    status: "draft",
    house,
    name,
    concentration: "",
    family: "",
    shortDescription: "",
    description: "",
    notes: { top: [], heart: [], base: [] },
    sourceBrand: "",
    authenticityCopy: "",
    whatArrives: "",
    copyApproved: false,
    physical: { bottleMaterial: "", capType: "", labelVersion: "", packagingNotes: "" },
    isSample: false,
    images: [],
    variants: [],
    variantIds: [],
    skus: [],
    publicFiles: [],
    publishedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export type StockStatus = "in_stock" | "low_stock" | "out_of_stock";

export function stockStatus(variant: Pick<VariantRec, "stockQuantity" | "lowStockThreshold" | "active">): StockStatus {
  if (!variant.active || variant.stockQuantity <= 0) return "out_of_stock";
  return variant.stockQuantity <= variant.lowStockThreshold ? "low_stock" : "in_stock";
}

export const isPublic = (product: Pick<ProductDoc, "status" | "isSample">) => product.status === "published" && !product.isSample;

// ---------- Publish readiness ----------

export type ReadinessCheck = { code: string; ok: boolean; message: string };

const placeholderPattern = /\b(lorem|ipsum|placeholder|sample|test product|tbd|todo|concept)\b/i;

export function publishReadiness(product: ProductDoc): ReadinessCheck[] {
  const approved = product.images.filter((image) => image.approved);
  const activeVariants = product.variants.filter((variant) => variant.active);
  const imageById = new Map(product.images.map((image) => [image.id, image]));
  const filled = (value: string) => value.trim().length > 0;

  return [
    {
      code: "not_sample",
      ok: !product.isSample,
      message: "Not a synthetic sample record (samples can never be published).",
    },
    {
      code: "identity",
      ok: filled(product.house) && filled(product.name) && !placeholderPattern.test(`${product.house} ${product.name}`),
      message: "Real fragrance house and name (no placeholder wording).",
    },
    {
      code: "facts",
      ok: filled(product.concentration) && filled(product.family),
      message: "Concentration and scent family.",
    },
    {
      code: "copy",
      ok:
        filled(product.shortDescription) &&
        filled(product.description) &&
        !placeholderPattern.test(`${product.shortDescription} ${product.description}`),
      message: "Short description and full description.",
    },
    {
      code: "trust_copy",
      ok: filled(product.sourceBrand) && filled(product.authenticityCopy) && filled(product.whatArrives),
      message: "Source brand, authenticity statement and “what arrives” copy.",
    },
    {
      code: "copy_approved",
      ok: product.copyApproved,
      message: "Product copy marked as approved.",
    },
    {
      code: "physical_spec",
      ok: filled(product.physical.bottleMaterial) && filled(product.physical.capType) && filled(product.physical.labelVersion),
      message: "Decant bottle material, cap/sprayer type and label version.",
    },
    {
      code: "decant_photo",
      ok: approved.some((image) => image.role === "decant-front" && image.isRealPhoto && approvalProblems(image).length === 0),
      message: "At least one approved, real decant-front photo.",
    },
    {
      code: "variant",
      ok: activeVariants.length > 0,
      message: "At least one active size variant.",
    },
    {
      code: "variant_prices",
      ok: activeVariants.length > 0 && activeVariants.every((variant) => variant.priceMinor > 0 && variant.sizeMl > 0),
      message: "Every active variant has a size and a price above zero.",
    },
    {
      code: "variant_images",
      ok: activeVariants.every((variant) => {
        if (!variant.bottleDiffers) return true;
        const image = variant.imageId ? imageById.get(variant.imageId) : undefined;
        return Boolean(image?.approved && image.isRealPhoto);
      }),
      message: "Variants whose bottle looks different have their own approved photo.",
    },
  ];
}

export const isPublishable = (checks: ReadinessCheck[]) => checks.every((check) => check.ok);

// ---------- Repository ----------

const products = (store: Store) => store.db.collection(COLLECTIONS.products);

export async function getProduct(store: Store, id: string, tx?: Transaction): Promise<Product> {
  const ref = products(store).doc(id);
  const snapshot = tx ? await tx.get(ref) : await ref.get();
  if (!snapshot.exists) throw notFound("Product");
  return { id, ...(snapshot.data() as ProductDoc) };
}

export async function listPublicProducts(store: Store): Promise<Product[]> {
  const snapshot = await products(store).where("status", "==", "published").where("isSample", "==", false).get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...(doc.data() as ProductDoc) }));
}

// Recomputes the derived query fields. Call before every write.
export function finalize(product: ProductDoc): ProductDoc {
  product.variants.sort((a, b) => a.sortOrder - b.sortOrder || a.sizeMl - b.sizeMl);
  product.variantIds = product.variants.map((variant) => variant.id);
  product.skus = product.variants.map((variant) => variant.sku);
  product.publicFiles = isPublic(product) ? product.images.filter((image) => image.approved).map((image) => image.fileName) : [];
  return product;
}

export async function assertUniqueSlug(store: Store, slug: string, exceptId: string | null, tx?: Transaction) {
  const query = products(store).where("slug", "==", slug).limit(2);
  const snapshot = tx ? await tx.get(query) : await query.get();
  if (snapshot.docs.some((doc) => doc.id !== exceptId)) throw conflict("slug_taken", "That URL slug is already in use.");
}

export async function uniqueSlug(store: Store, base: string): Promise<string> {
  const root = base || "fragrance";
  for (let index = 1; ; index++) {
    const candidate = index === 1 ? root : `${root}-${index}`;
    const snapshot = await products(store).where("slug", "==", candidate).limit(1).get();
    if (snapshot.empty) return candidate;
  }
}

export async function assertUniqueSkus(store: Store, productId: string, skus: string[], tx: Transaction) {
  if (skus.length === 0) return;
  const lower = new Set(skus.map((sku) => sku.toUpperCase()));
  if (lower.size !== skus.length) throw conflict("sku_taken", "That SKU is already in use.");
  for (let index = 0; index < skus.length; index += 30) {
    const chunk = skus.slice(index, index + 30);
    const snapshot = await tx.get(products(store).where("skus", "array-contains-any", chunk));
    if (snapshot.docs.some((doc) => doc.id !== productId)) throw conflict("sku_taken", "That SKU is already in use.");
  }
}

// Read-modify-write of one product inside a transaction. A product that is live
// after the change must still pass every publish check, or nothing is written.
export async function mutateProduct<T>(
  store: Store,
  id: string,
  change: (product: ProductDoc, tx: Transaction) => T | Promise<T>,
): Promise<{ product: Product; result: T }> {
  return store.db.runTransaction(async (tx) => {
    const { id: _id, ...product } = await getProduct(store, id, tx);
    const result = await change(product, tx);
    finalize(product);
    if (product.status === "published") {
      const failing = publishReadiness(product).filter((check) => !check.ok);
      if (failing.length) {
        throw new ApiError(
          422,
          "publish_gate_failed",
          "This change would leave the published product incomplete. Unpublish it first or fix the issues.",
          failing,
        );
      }
    }
    product.updatedAt = now();
    tx.set(products(store).doc(id), product);
    return { product: { id, ...product }, result };
  });
}

// ---------- Admin serialization ----------

export function adminImage(image: ImageRec, productId: string | null) {
  return {
    id: image.id,
    productId,
    role: image.role,
    alt: image.alt,
    url: `/api/admin/media/${image.fileName}`,
    mime: image.mime,
    bytes: image.bytes,
    width: image.width,
    height: image.height,
    originalName: image.originalName,
    isRealPhoto: image.isRealPhoto,
    approved: image.approved,
    approvalProblems: approvalProblems(image),
    sortOrder: image.sortOrder,
    createdAt: image.createdAt,
  };
}

export function adminVariant(variant: VariantRec, productId: string) {
  return { ...variant, productId, currency: "GHS" as const, stockStatus: stockStatus(variant) };
}

export function adminProductSummary(product: Product) {
  const hero = sortImages(product.images)[0];
  return {
    id: product.id,
    slug: product.slug,
    status: product.status,
    house: product.house,
    name: product.name,
    family: product.family,
    isSample: product.isSample,
    variantCount: product.variants.length,
    totalStock: product.variants.reduce((sum, variant) => sum + variant.stockQuantity, 0),
    minPriceMinor: product.variants.length ? Math.min(...product.variants.map((variant) => variant.priceMinor)) : null,
    thumbnailUrl: hero ? `/api/admin/media/${hero.fileName}` : null,
    updatedAt: product.updatedAt,
    publishedAt: product.publishedAt,
  };
}

export function adminProduct(product: Product) {
  const readiness = publishReadiness(product);
  return {
    id: product.id,
    slug: product.slug,
    status: product.status,
    house: product.house,
    name: product.name,
    concentration: product.concentration,
    family: product.family,
    shortDescription: product.shortDescription,
    description: product.description,
    notes: product.notes,
    sourceBrand: product.sourceBrand,
    authenticityCopy: product.authenticityCopy,
    whatArrives: product.whatArrives,
    copyApproved: product.copyApproved,
    physical: product.physical,
    isSample: product.isSample,
    publishedAt: product.publishedAt,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
    images: sortImages(product.images).map((image) => adminImage(image, product.id)),
    variants: product.variants.map((variant) => adminVariant(variant, product.id)),
    readiness,
    publishable: isPublishable(readiness),
  };
}

// ---------- Public serialization (published only) ----------

export type PublicImage = { url: string; alt: string; role: ImageRole; caption?: string };

function publicImage(baseUrl: string, image: ImageRec): PublicImage {
  const out: PublicImage = { url: `${baseUrl}/media/${image.fileName}`, alt: image.alt, role: image.role };
  if (image.role === "source-bottle") out.caption = "Original full-size bottle, shown for reference. You receive an Esspor decant.";
  return out;
}

const sellable = (product: ProductDoc) => product.variants.filter((variant) => variant.active && variant.priceMinor > 0);

export function publicSummary(baseUrl: string, product: Product) {
  const images = sortImages(product.images).filter((image) => image.approved);
  const variants = sellable(product);
  const hero = images.find((image) => image.role === "decant-front") ?? images[0]!;
  return {
    id: product.id,
    slug: product.slug,
    status: "published" as const,
    house: product.house,
    name: product.name,
    concentration: product.concentration,
    family: product.family,
    shortDescription: product.shortDescription,
    heroImage: publicImage(baseUrl, hero),
    minPriceMinor: variants.length ? Math.min(...variants.map((variant) => variant.priceMinor)) : 0,
    currency: "GHS" as const,
    available: variants.some((variant) => stockStatus(variant) !== "out_of_stock"),
  };
}

export function publicDetail(baseUrl: string, product: Product) {
  const images = sortImages(product.images).filter((image) => image.approved);
  const imageMap = new Map(images.map((image) => [image.id, image]));
  return {
    ...publicSummary(baseUrl, product),
    description: product.description,
    notes: product.notes,
    images: images.map((image) => publicImage(baseUrl, image)),
    sourceBrand: product.sourceBrand,
    authenticityCopy: product.authenticityCopy,
    whatArrives: product.whatArrives,
    variants: sellable(product).map((variant) => {
      const image = variant.imageId ? imageMap.get(variant.imageId) : undefined;
      const status = stockStatus(variant);
      return {
        id: variant.id,
        sku: variant.sku,
        sizeMl: variant.sizeMl,
        priceMinor: variant.priceMinor,
        currency: "GHS" as const,
        available: status !== "out_of_stock",
        stockStatus: status,
        ...(image ? { image: publicImage(baseUrl, image) } : {}),
      };
    }),
  };
}
