export type ImageRole =
  | "decant-front"
  | "decant-side"
  | "sprayer"
  | "source-bottle"
  | "packaging"
  | "editorial";

export type MediaKind = "image" | "video";

export type ProductImage = {
  url: string;
  alt: string;
  role: ImageRole;
  /** Photo or short video. Older responses omit it; treat a missing value as a photo. */
  kind?: MediaKind;
  mime?: string;
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

export type FulfilmentMethod = "delivery" | "pickup";

export type DeliveryOption = {
  code: string;
  label: string;
  description: string;
  priceMinor: number;
  method: FulfilmentMethod;
};

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

export type PlacedOrder = {
  order: {
    number: string;
    status: string;
    fulfilmentMethod: FulfilmentMethod;
    deliveryLabel: string;
    deliveryMinor: number;
    totalMinor: number;
    currency: "GHS";
    items: { sku: string; house: string; name: string; sizeMl: number; quantity: number; unitPriceMinor: number; lineTotalMinor: number }[];
  };
  payment: { provider: string; status: string; reference: string | null; authorizationUrl: string | null; message: string };
};

export class OrderError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

// Checkout asks for a name and phone number, plus an address when the order is delivered.
export async function placeOrder(input: {
  items: { variantId: string; quantity: number }[];
  deliveryOptionCode?: string | undefined;
  customer: { name: string; phone: string; address?: string | undefined };
}): Promise<PlacedOrder> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/v1/orders`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  } catch {
    throw new OrderError("network", "We couldn't reach Esspor. Check your connection and try again.");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = data?.error ?? {};
    const first = Array.isArray(error.details) ? error.details[0]?.message : "";
    throw new OrderError(error.code ?? "error", first || error.message || "Your order could not be placed. Please try again.");
  }
  return data as PlacedOrder;
}

export type TrackedOrder = {
  number: string;
  status: "pending_payment" | "paid" | "processing" | "shipped" | "delivered" | "cancelled" | "refunded";
  stage: { label: string; detail: string };
  fulfilmentMethod: FulfilmentMethod;
  deliveryLabel: string;
  items: { house: string; name: string; sizeMl: number; quantity: number }[];
  subtotalMinor: number;
  deliveryMinor: number;
  totalMinor: number;
  currency: "GHS";
  paymentStatus: string;
  canPay: boolean;
  createdAt: string;
  updatedAt: string;
  timeline: { label: string; at: string }[];
};

// The order number is the only thing needed, so it is the only thing sent.
export async function trackOrder(number: string): Promise<TrackedOrder> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/v1/track/${encodeURIComponent(number.trim())}`, { headers: { Accept: "application/json" } });
  } catch {
    throw new OrderError("network", "We couldn't reach Esspor. Check your connection and try again.");
  }
  if (response.status === 404) throw new OrderError("not_found", "We couldn't find that order. Check the number in your screenshot.");
  if (response.status === 429) throw new OrderError("rate_limited", "Too many tries. Please wait a minute and try again.");
  if (!response.ok) throw new OrderError("error", "Your order status couldn't be loaded right now. Please try again.");
  return response.json() as Promise<TrackedOrder>;
}

// Starts a new payment for an order that is still unpaid and returns where to pay.
export async function payForOrder(number: string): Promise<{ status: string; authorizationUrl: string | null; message: string }> {
  const response = await fetch(`${baseUrl}/api/v1/track/${encodeURIComponent(number)}/pay`, { method: "POST", headers: { Accept: "application/json" } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new OrderError(data?.error?.code ?? "error", data?.error?.message ?? "Payment couldn't be started. Please try again.");
  return data.payment;
}

export function formatMoney(minor: number): string {
  return new Intl.NumberFormat("en-GH", {
    style: "currency",
    currency: "GHS",
  }).format(minor / 100);
}
