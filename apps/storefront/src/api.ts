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

export function formatMoney(minor: number): string {
  return new Intl.NumberFormat("en-GH", {
    style: "currency",
    currency: "GHS",
  }).format(minor / 100);
}
