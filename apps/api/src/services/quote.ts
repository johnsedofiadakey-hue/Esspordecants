import type { Transaction } from "firebase-admin/firestore";
import { COLLECTIONS, type Store } from "../firebase.ts";
import { isPublic, stockStatus, type Product, type ProductDoc, type VariantRec } from "./products.ts";

export const MAX_LINE_QUANTITY = 10;
export const MAX_LINES = 20;

export type QuoteInput = {
  items: { variantId: string; quantity: number }[];
  deliveryOptionCode?: string | undefined;
};

export type DeliveryOption = { code: string; label: string; description: string; priceMinor: number };

export type QuoteLine = {
  variantId: string;
  productId: string;
  slug: string;
  sku: string;
  house: string;
  name: string;
  sizeMl: number;
  quantity: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
  available: boolean;
};

export type QuoteError = { variantId: string; code: string; message: string; availableQuantity?: number };

export type Quote = {
  currency: "GHS";
  items: QuoteLine[];
  errors: QuoteError[];
  subtotalMinor: number;
  deliveryOptions: DeliveryOption[];
  selectedDeliveryOptionCode: string | null;
  deliveryMinor: number;
  totalMinor: number;
  checkoutAvailable: boolean;
  checkoutMessage: string;
};

export type DeliveryDoc = DeliveryOption & { active: boolean; sortOrder: number; createdAt: string; updatedAt: string };

export async function activeDeliveryOptions(store: Store, tx?: Transaction): Promise<DeliveryOption[]> {
  const query = store.db.collection(COLLECTIONS.delivery).where("active", "==", true);
  const snapshot = tx ? await tx.get(query) : await query.get();
  return snapshot.docs
    .map((doc) => doc.data() as DeliveryDoc)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label))
    .map(({ code, label, description, priceMinor }) => ({ code, label, description, priceMinor }));
}

export function mergeLines(items: QuoteInput["items"]) {
  const merged = new Map<string, number>();
  for (const item of items) merged.set(item.variantId, (merged.get(item.variantId) ?? 0) + item.quantity);
  return merged;
}

// Loads the products that own the given variant ids (one query per 30 ids).
export async function productsForVariants(store: Store, variantIds: string[], tx?: Transaction): Promise<Map<string, Product>> {
  const owners = new Map<string, Product>();
  for (let index = 0; index < variantIds.length; index += 30) {
    const query = store.db
      .collection(COLLECTIONS.products)
      .where("variantIds", "array-contains-any", variantIds.slice(index, index + 30));
    const snapshot = tx ? await tx.get(query) : await query.get();
    for (const doc of snapshot.docs) {
      const product = { id: doc.id, ...(doc.data() as ProductDoc) };
      for (const variant of product.variants) owners.set(variant.id, product);
    }
  }
  return owners;
}

// Pure pricing: prices, stock and delivery come only from the loaded documents;
// the client contributes ids and quantities.
export function priceQuote(
  input: QuoteInput,
  owners: Map<string, Product>,
  deliveryOptions: DeliveryOption[],
  checkoutEnabled: boolean,
): Quote {
  const items: QuoteLine[] = [];
  const errors: QuoteError[] = [];

  for (const [variantId, quantity] of mergeLines(input.items)) {
    const product = owners.get(variantId);
    const variant: VariantRec | undefined = product?.variants.find((entry) => entry.id === variantId);
    if (!product || !variant || !isPublic(product) || !variant.active || variant.priceMinor <= 0) {
      errors.push({ variantId, code: "variant_unavailable", message: "This size is no longer available." });
      continue;
    }
    let available = true;
    if (quantity > MAX_LINE_QUANTITY) {
      available = false;
      errors.push({ variantId, code: "quantity_limit", message: `You can order up to ${MAX_LINE_QUANTITY} of each size.` });
    } else if (stockStatus(variant) === "out_of_stock") {
      available = false;
      errors.push({ variantId, code: "out_of_stock", message: "This size is out of stock.", availableQuantity: 0 });
    } else if (variant.stockQuantity < quantity) {
      available = false;
      errors.push({
        variantId,
        code: "insufficient_stock",
        message: `Only ${variant.stockQuantity} available.`,
        availableQuantity: variant.stockQuantity,
      });
    }
    items.push({
      variantId,
      productId: product.id,
      slug: product.slug,
      sku: variant.sku,
      house: product.house,
      name: product.name,
      sizeMl: variant.sizeMl,
      quantity,
      unitPriceMinor: variant.priceMinor,
      lineTotalMinor: variant.priceMinor * quantity,
      available,
    });
  }

  const subtotalMinor = items.filter((line) => line.available).reduce((sum, line) => sum + line.lineTotalMinor, 0);
  const selected = deliveryOptions.find((option) => option.code === input.deliveryOptionCode) ?? null;
  if (input.deliveryOptionCode && !selected) {
    errors.push({ variantId: "", code: "delivery_option_unavailable", message: "Choose an available delivery option." });
  }
  const deliveryMinor = selected?.priceMinor ?? 0;

  let checkoutMessage = "";
  if (!checkoutEnabled) checkoutMessage = "Online checkout is not open yet. Payment and delivery are being finalised.";
  else if (deliveryOptions.length === 0) checkoutMessage = "Delivery options are not configured yet.";

  return {
    currency: "GHS",
    items,
    errors,
    subtotalMinor,
    deliveryOptions,
    selectedDeliveryOptionCode: selected?.code ?? null,
    deliveryMinor,
    totalMinor: subtotalMinor + deliveryMinor,
    checkoutAvailable: checkoutEnabled && deliveryOptions.length > 0,
    checkoutMessage,
  };
}

export async function buildQuote(store: Store, input: QuoteInput, checkoutEnabled: boolean): Promise<Quote> {
  const ids = [...mergeLines(input.items).keys()];
  const [owners, delivery] = await Promise.all([productsForVariants(store, ids), activeDeliveryOptions(store)]);
  return priceQuote(input, owners, delivery, checkoutEnabled);
}
