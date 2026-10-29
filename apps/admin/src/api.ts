import { idToken } from "./auth.ts";

export type ImageRole = "decant-front" | "decant-side" | "sprayer" | "source-bottle" | "packaging" | "editorial";
export const IMAGE_ROLES: { value: ImageRole; label: string; hint: string }[] = [
  { value: "decant-front", label: "Decant · front", hint: "The actual Esspor decant the buyer receives. Shown first." },
  { value: "decant-side", label: "Decant · side", hint: "Side view of the actual decant." },
  { value: "sprayer", label: "Cap / sprayer", hint: "Close-up of the cap or atomiser." },
  { value: "packaging", label: "Packaging", hint: "Box, pouch or label as shipped." },
  { value: "source-bottle", label: "Source bottle", hint: "The original full-size bottle. Shown as reference only." },
  { value: "editorial", label: "Editorial", hint: "Mood or lifestyle image." },
];

export type User = { id: string; email: string; name: string; role: "owner" | "editor" };

export type TeamMember = User & { disabled: boolean; createdAt: string; lastLoginAt: string | null };

export type AdminImage = {
  id: string;
  productId: string | null;
  role: ImageRole;
  alt: string;
  url: string;
  width: number | null;
  height: number | null;
  bytes: number;
  originalName: string;
  isRealPhoto: boolean;
  approved: boolean;
  approvalProblems: string[];
  sortOrder: number;
};

export type Variant = {
  id: string;
  sku: string;
  sizeMl: number;
  priceMinor: number;
  stockQuantity: number;
  lowStockThreshold: number;
  stockStatus: "in_stock" | "low_stock" | "out_of_stock";
  active: boolean;
  bottleDiffers: boolean;
  imageId: string | null;
  packagingNotes: string;
  sortOrder: number;
};

export type ReadinessCheck = { code: string; ok: boolean; message: string };

export type Product = {
  id: string;
  slug: string;
  status: "draft" | "published" | "archived";
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
  publishedAt: string | null;
  updatedAt: string;
  images: AdminImage[];
  variants: Variant[];
  readiness: ReadinessCheck[];
  publishable: boolean;
};

export type ProductSummary = {
  id: string;
  slug: string;
  status: Product["status"];
  house: string;
  name: string;
  family: string;
  isSample: boolean;
  variantCount: number;
  totalStock: number;
  minPriceMinor: number | null;
  thumbnailUrl: string | null;
  updatedAt: string;
};

export type OrderSummary = {
  id: string;
  number: string;
  status: string;
  paymentStatus: string;
  customerName: string;
  customerEmail: string;
  totalMinor: number;
  isSample: boolean;
  createdAt: string;
};

export type Order = OrderSummary & {
  paymentProvider: string;
  customerPhone: string;
  deliveryAddress: { line1?: string; line2?: string; city?: string; region?: string; notes?: string };
  deliveryLabel: string;
  subtotalMinor: number;
  deliveryMinor: number;
  internalNotes: string;
  allowedTransitions: string[];
  items: { id: string; sku: string; house: string; name: string; sizeMl: number; unitPriceMinor: number; quantity: number; lineTotalMinor: number }[];
  events: { id: string; type: string; from: string | null; to: string | null; note: string; actorName: string | null; createdAt: string }[];
};

export type ContentEntry = {
  id: string;
  slug: string;
  placement: string;
  status: "draft" | "published";
  eyebrow: string;
  title: string;
  body: string;
  ctaLabel: string;
  ctaHref: string;
  imageId: string | null;
  image: AdminImage | null;
  sortOrder: number;
  updatedAt: string;
};

export type DeliveryOption = {
  id: string;
  code: string;
  label: string;
  description: string;
  priceMinor: number;
  active: boolean;
  sortOrder: number;
};

export type Summary = {
  products: { draft: number; published: number; archived: number };
  orders: { open: number; total: number };
  lowStock: { variantId: string; productId: string; label: string; sku: string; stockQuantity: number; stockStatus: string }[];
  checkoutEnabled: boolean;
  deliveryOptionsActive: number;
  paymentProvider: string;
};

export class ApiError extends Error {
  status: number;
  code: string;
  details: unknown;
  constructor(status: number, code: string, message: string, details: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

let onUnauthorized: () => void = () => {};

export function setUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler;
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await idToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json", ...(await authHeaders()) };
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const response = await fetch(`/api/admin${path}`, { method, headers, body: payload });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = data?.error ?? {};
    if (response.status === 401) onUnauthorized();
    throw new ApiError(response.status, error.code ?? "error", error.message ?? "Request failed.", error.details);
  }
  return data as T;
}

// Draft images are only served to signed-in admins, so previews are fetched with
// the ID token and shown from an object URL.
export async function fetchImage(url: string): Promise<string> {
  const response = await fetch(url, { headers: await authHeaders() });
  if (!response.ok) throw new Error(`Image request failed (${response.status}).`);
  return URL.createObjectURL(await response.blob());
}

export const formatMoney = (minor: number) =>
  new Intl.NumberFormat("en-GH", { style: "currency", currency: "GHS" }).format(minor / 100);

export const toMinor = (cedis: string) => Math.round(Number(cedis.replace(/[^0-9.]/g, "")) * 100);
export const toCedis = (minor: number) => (minor / 100).toFixed(2);

export const formatDate = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

export const humanize = (value: string) => value.replace(/[_-]/g, " ").replace(/^\w/, (char) => char.toUpperCase());
