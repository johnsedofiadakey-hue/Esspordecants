import { z } from "zod";
import { COLLECTIONS, type Store } from "../firebase.ts";
import { fold, newId, slugify } from "../lib/util.ts";
import { recordStock } from "./orders.ts";
import { invalidateCatalog } from "./catalog.ts";
import { assertUniqueSkus, assertUniqueSlug, emptyProduct, finalize, type ProductDoc, type VariantRec } from "./products.ts";

// One row per size. Rows sharing a house and name become one draft product. Imported
// products are always drafts and never overwrite an existing product: photos, the
// real-photo checks and approval still happen in the editor before anything is public.
const text = (max: number) => z.string().trim().max(max).default("");

export const importRow = z.object({
  house: z.string().trim().min(1, "House is required.").max(120),
  name: z.string().trim().min(1, "Name is required.").max(160),
  concentration: text(60),
  family: text(60),
  shortDescription: text(280),
  description: text(6000),
  notesTop: text(600),
  notesHeart: text(600),
  notesBase: text(600),
  sourceBrand: text(160),
  sku: z
    .string()
    .trim()
    .min(3, "SKU needs at least 3 characters.")
    .max(40)
    .regex(/^[A-Za-z0-9-]+$/, "SKU: use letters, numbers and hyphens.")
    .transform((value) => value.toUpperCase()),
  sizeMl: z.coerce.number({ error: "Size (ml) must be a number." }).positive("Size must be above 0.").max(200),
  priceGhs: z.coerce.number({ error: "Price must be a number." }).min(0, "Price cannot be negative.").max(1_000_000),
  stock: z.coerce.number({ error: "Stock must be a number." }).int("Stock must be a whole number.").min(0).max(100_000).default(0),
});
export type ImportRow = z.infer<typeof importRow>;

export const MAX_IMPORT_ROWS = 300;

const notes = (value: string) =>
  value
    .split(/[;,|]/)
    .map((note) => note.trim())
    .filter(Boolean)
    .slice(0, 20)
    .map((note) => note.slice(0, 60));

export type ImportReport = {
  dryRun: boolean;
  created: { house: string; name: string; slug: string; sizes: number }[];
  skipped: { house: string; name: string; reason: string }[];
  errors: { row: number; message: string }[];
};

export async function importProducts(store: Store, rawRows: unknown[], options: { dryRun: boolean; actorId: string }): Promise<ImportReport> {
  const report: ImportReport = { dryRun: options.dryRun, created: [], skipped: [], errors: [] };
  const groups = new Map<string, { rows: { row: number; data: ImportRow }[] }>();

  rawRows.forEach((raw, index) => {
    const parsed = importRow.safeParse(raw);
    if (!parsed.success) {
      report.errors.push({ row: index + 2, message: parsed.error.issues.map((issue) => issue.message).join(" ") });
      return;
    }
    const key = `${fold(parsed.data.house)}|${fold(parsed.data.name)}`;
    const group = groups.get(key) ?? { rows: [] };
    group.rows.push({ row: index + 2, data: parsed.data });
    groups.set(key, group);
  });

  // A SKU or size repeated inside the file would collide on save; say so up front.
  const seenSkus = new Map<string, number>();
  for (const group of groups.values()) {
    const sizes = new Set<number>();
    for (const { row, data } of group.rows) {
      const earlier = seenSkus.get(data.sku);
      if (earlier) report.errors.push({ row, message: `SKU ${data.sku} is already used on row ${earlier}.` });
      else seenSkus.set(data.sku, row);
      if (sizes.has(data.sizeMl)) report.errors.push({ row, message: `${data.sizeMl} ml appears twice for ${data.house} ${data.name}.` });
      sizes.add(data.sizeMl);
    }
  }
  const badRows = new Set(report.errors.map((error) => error.row));

  for (const { rows } of groups.values()) {
    const first = rows[0]!.data;
    if (rows.some(({ row }) => badRows.has(row))) {
      report.skipped.push({ house: first.house, name: first.name, reason: "Fix the errors on its rows first." });
      continue;
    }
    const slug = slugify(`${first.house} ${first.name}`);
    const existing = await store.db.collection(COLLECTIONS.products).where("slug", "==", slug).limit(1).get();
    if (!existing.empty) {
      report.skipped.push({ house: first.house, name: first.name, reason: "A product with this name already exists. It was left untouched." });
      continue;
    }
    if (options.dryRun) {
      report.created.push({ house: first.house, name: first.name, slug, sizes: rows.length });
      continue;
    }
    const id = newId();
    try {
      await store.db.runTransaction(async (tx) => {
        await assertUniqueSlug(store, slug, null, tx);
        const product: ProductDoc = emptyProduct(first.house, first.name, slug);
        product.concentration = first.concentration;
        product.family = first.family;
        product.shortDescription = first.shortDescription;
        product.description = first.description;
        product.sourceBrand = first.sourceBrand;
        product.notes = { top: notes(first.notesTop), heart: notes(first.notesHeart), base: notes(first.notesBase) };
        product.variants = rows.map(({ data }, order): VariantRec => ({
          id: newId(),
          sku: data.sku,
          sizeMl: data.sizeMl,
          priceMinor: Math.round(data.priceGhs * 100),
          stockQuantity: data.stock,
          lowStockThreshold: 3,
          active: true,
          bottleDiffers: false,
          imageId: null,
          packagingNotes: "",
          sortOrder: order,
        }));
        finalize(product);
        await assertUniqueSkus(store, id, product.skus, tx);
        tx.set(store.db.collection(COLLECTIONS.products).doc(id), product);
        for (const variant of product.variants) {
          if (variant.stockQuantity) {
            recordStock(store, tx, { variantId: variant.id, productId: id, delta: variant.stockQuantity, reason: "imported stock", orderId: null, actorUserId: options.actorId });
          }
        }
      });
      report.created.push({ house: first.house, name: first.name, slug, sizes: rows.length });
    } catch (error) {
      report.skipped.push({ house: first.house, name: first.name, reason: error instanceof Error ? error.message : "Could not be saved." });
    }
  }
  if (!options.dryRun) invalidateCatalog(store);
  return report;
}
