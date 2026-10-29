import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv, Deps } from "../context.ts";
import { COLLECTIONS } from "../firebase.ts";
import { ApiError, notFound } from "../lib/errors.ts";
import { fold } from "../lib/util.ts";
import { parse, readJson } from "../lib/validate.ts";
import { MEDIA_FILE, MEDIA_TYPES, readImageFile } from "../services/images.ts";
import { placeOrder } from "../services/orders.ts";
import { listPublicProducts, publicDetail, publicSummary, type Product } from "../services/products.ts";
import { buildQuote, MAX_LINES } from "../services/quote.ts";
import { publicContent, type ContentDoc } from "./admin/content.ts";

const listQuery = z.object({
  query: z.string().trim().max(100).optional().default(""),
  family: z.string().trim().max(60).optional().default(""),
  page: z.coerce.number().int().min(1).max(1000).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(48).optional().default(12),
});

const quoteBody = z.object({
  items: z
    .array(
      z.object({
        variantId: z.string().min(1).max(64),
        quantity: z.number().int().min(1).max(99),
      }),
    )
    .max(MAX_LINES),
  deliveryOptionCode: z.string().max(40).optional(),
});

const orderBody = quoteBody.extend({
  items: quoteBody.shape.items.min(1),
  customer: z.object({
    name: z.string().trim().min(2).max(120),
    email: z.email().max(200),
    phone: z.string().trim().min(7).max(30),
    address: z.object({
      line1: z.string().trim().min(2).max(200),
      line2: z.string().trim().max(200).optional(),
      city: z.string().trim().min(2).max(100),
      region: z.string().trim().min(2).max(100),
      notes: z.string().trim().max(500).optional(),
    }),
  }),
});

// Public catalogue reads can be cached briefly by browsers and the Hosting CDN.
const CACHE_PUBLIC = "public, max-age=30, s-maxage=60";

function searchText(product: Product) {
  return fold(
    [product.house, product.name, product.family, product.shortDescription, ...product.notes.top, ...product.notes.heart, ...product.notes.base].join(" "),
  );
}

export function publicRoutes(deps: Deps) {
  const { store, config } = deps;
  const app = new Hono<AppEnv>();

  app.get("/api/v1/health", (c) => c.json({ ok: true, checkoutEnabled: config.checkoutEnabled }));

  // The catalogue is small (tens to low hundreds of products), so published
  // products are loaded and filtered in memory; Firestore has no substring search.
  app.get("/api/v1/products", async (c) => {
    const query = parse(listQuery, c.req.query());
    const needle = fold(query.query);
    const family = fold(query.family);
    const matches = (await listPublicProducts(store))
      .filter((product) => !needle || searchText(product).includes(needle))
      .filter((product) => !family || fold(product.family) === family)
      .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? "") || a.name.localeCompare(b.name));
    const start = (query.page - 1) * query.pageSize;
    c.header("Cache-Control", CACHE_PUBLIC);
    return c.json({
      items: matches.slice(start, start + query.pageSize).map((product) => publicSummary(config.publicBaseUrl, product)),
      page: query.page,
      pageSize: query.pageSize,
      total: matches.length,
    });
  });

  app.get("/api/v1/products/:slug", async (c) => {
    const snapshot = await store.db
      .collection(COLLECTIONS.products)
      .where("slug", "==", c.req.param("slug"))
      .where("status", "==", "published")
      .where("isSample", "==", false)
      .limit(1)
      .get();
    const doc = snapshot.docs[0];
    if (!doc) throw notFound("Fragrance");
    c.header("Cache-Control", CACHE_PUBLIC);
    return c.json(publicDetail(config.publicBaseUrl, { id: doc.id, ...(doc.data() as Omit<Product, "id">) }));
  });

  app.get("/api/v1/families", async (c) => {
    const counts = new Map<string, number>();
    for (const product of await listPublicProducts(store)) counts.set(product.family, (counts.get(product.family) ?? 0) + 1);
    c.header("Cache-Control", CACHE_PUBLIC);
    return c.json({
      items: [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([name, count]) => ({ name, count })),
    });
  });

  app.get("/api/v1/content", async (c) => {
    const placement = c.req.query("placement");
    let query = store.db.collection(COLLECTIONS.content).where("status", "==", "published");
    if (placement) query = query.where("placement", "==", placement);
    const docs = (await query.get()).docs.map((doc) => doc.data() as ContentDoc);
    docs.sort((a, b) => a.placement.localeCompare(b.placement) || a.sortOrder - b.sortOrder || a.title.localeCompare(b.title));
    c.header("Cache-Control", CACHE_PUBLIC);
    return c.json({ items: docs.map((doc) => publicContent(config.publicBaseUrl, doc)) });
  });

  app.get("/api/v1/content/:slug", async (c) => {
    const snapshot = await store.db
      .collection(COLLECTIONS.content)
      .where("slug", "==", c.req.param("slug"))
      .where("status", "==", "published")
      .limit(1)
      .get();
    const doc = snapshot.docs[0];
    if (!doc) throw notFound("Content");
    c.header("Cache-Control", CACHE_PUBLIC);
    return c.json(publicContent(config.publicBaseUrl, doc.data() as ContentDoc));
  });

  app.post("/api/v1/checkout/quote", async (c) => {
    const body = await readJson(c, quoteBody);
    c.header("Cache-Control", "no-store");
    return c.json(await buildQuote(store, body, config.checkoutEnabled));
  });

  // Order placement is wired to the payment adapter but stays closed until payment
  // and delivery are confirmed (CHECKOUT_ENABLED=true). See docs/SHARED_CONTRACT.md.
  app.post("/api/v1/orders", async (c) => {
    if (!config.checkoutEnabled) {
      throw new ApiError(503, "checkout_unavailable", "Online checkout is not open yet.");
    }
    const body = await readJson(c, orderBody);
    const { order, payment } = await placeOrder(store, deps.payments, body);
    c.header("Cache-Control", "no-store");
    return c.json(
      {
        order: {
          number: order.number,
          status: order.status,
          totalMinor: order.totalMinor,
          currency: order.currency,
          items: order.items.map(({ sku, house, name, sizeMl, quantity, unitPriceMinor, lineTotalMinor }) => ({
            sku,
            house,
            name,
            sizeMl,
            quantity,
            unitPriceMinor,
            lineTotalMinor,
          })),
        },
        payment,
      },
      201,
    );
  });

  // Serves an image only while it is approved and attached to something published.
  app.get("/media/:file", async (c) => {
    const file = c.req.param("file");
    if (!MEDIA_FILE.test(file)) throw notFound("Image");
    const [products, content] = await Promise.all([
      store.db.collection(COLLECTIONS.products).where("publicFiles", "array-contains", file).limit(1).get(),
      store.db.collection(COLLECTIONS.content).where("publicFiles", "array-contains", file).limit(1).get(),
    ]);
    if (products.empty && content.empty) throw notFound("Image");
    const data = await readImageFile(store.bucket, file);
    if (!data) throw notFound("Image");
    return c.body(new Uint8Array(data), 200, {
      "Content-Type": MEDIA_TYPES[file.split(".").pop()!] ?? "application/octet-stream",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
      "Cross-Origin-Resource-Policy": "cross-origin",
    });
  });

  return app;
}
