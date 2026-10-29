export type ImageRole =
  | "decant-front"
  | "decant-side"
  | "sprayer"
  | "source-bottle"
  | "packaging"
  | "editorial";

export type ProductImage = {
  url: string;
  alt: string;
  role: ImageRole;
  /** Present on source-bottle images: explains that the buyer receives a decant. */
  caption?: string;
};

export type ProductSummary = {
  id: string;
  slug: string;
  status: "published";
  house: string;
  name: string;
  concentration: string;
  family: string;
  shortDescription: string;
  heroImage: ProductImage;
  minPriceMinor: number;
  currency: "GHS";
  available: boolean;
};

export type Variant = {
  id: string;
  sku: string;
  sizeMl: number;
  priceMinor: number;
  currency: "GHS";
  available: boolean;
  stockStatus: string;
  image?: ProductImage;
};

export type Product = ProductSummary & {
  description: string;
  notes: { top: string[]; heart: string[]; base: string[] };
  images: ProductImage[];
  sourceBrand: string;
  authenticityCopy: string;
  whatArrives: string;
  variants: Variant[];
};

export type ProductPage = {
  items: ProductSummary[];
  page: number;
  pageSize: number;
  total: number;
};

const baseUrl = (
  import.meta.env.VITE_API_BASE_URL || "http://localhost:4000"
).replace(/\/$/, "");

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    if (response.status === 404)
      throw new Error("This fragrance is not available.");
    throw new Error("The collection could not be loaded right now.");
  }
  return response.json() as Promise<T>;
}

export function listProducts(query = "", family = ""): Promise<ProductPage> {
  const params = new URLSearchParams({ page: "1", pageSize: "24" });
  if (query) params.set("query", query);
  if (family) params.set("family", family);
  return getJson<ProductPage>(`/api/v1/products?${params}`);
}

export function getProduct(slug: string): Promise<Product> {
  return getJson<Product>(`/api/v1/products/${encodeURIComponent(slug)}`);
}

export type Family = { name: string; count: number };

export function listFamilies(): Promise<{ items: Family[] }> {
  return getJson<{ items: Family[] }>("/api/v1/families");
}

export type ContentEntry = {
  slug: string;
  placement: string;
  eyebrow: string;
  title: string;
  /** Plain text; blank lines separate paragraphs. Never render as HTML. */
  body: string;
  cta: { label: string; href: string } | null;
  image: ProductImage | null;
  updatedAt: string;
};

export function listContent(placement: string): Promise<{ items: ContentEntry[] }> {
  return getJson<{ items: ContentEntry[] }>(
    `/api/v1/content?placement=${encodeURIComponent(placement)}`,
  );
}

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

export type QuoteError = {
  variantId: string;
  code:
    | "variant_unavailable"
    | "out_of_stock"
    | "insufficient_stock"
    | "quantity_limit"
    | "delivery_option_unavailable"
    | string;
  message: string;
  availableQuantity?: number;
};

export type Quote = {
  currency: "GHS";
  items: QuoteLine[];
  errors: QuoteError[];
  subtotalMinor: number;
  deliveryOptions: { code: string; label: string; description: string; priceMinor: number }[];
  selectedDeliveryOptionCode: string | null;
  deliveryMinor: number;
  totalMinor: number;
  checkoutAvailable: boolean;
  checkoutMessage: string;
};

// Prices, stock and totals come from the server; only ids and quantities are sent.
export async function getQuote(
  items: { variantId: string; quantity: number }[],
  deliveryOptionCode?: string,
): Promise<Quote> {
  const response = await fetch(`${baseUrl}/api/v1/checkout/quote`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ items, deliveryOptionCode }),
  });
  if (!response.ok) throw new Error("Prices could not be confirmed right now.");
  return response.json() as Promise<Quote>;
}

export function formatMoney(minor: number): string {
  return new Intl.NumberFormat("en-GH", {
    style: "currency",
    currency: "GHS",
  }).format(minor / 100);
}
