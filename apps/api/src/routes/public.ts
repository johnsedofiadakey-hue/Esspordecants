import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv, Deps } from "../context.ts";
import { COLLECTIONS } from "../firebase.ts";
import { ApiError, notFound } from "../lib/errors.ts";
import { fold } from "../lib/util.ts";
import { parse, readJson } from "../lib/validate.ts";
import { mediaResponse, MEDIA_FILE } from "../services/images.ts";
import { rateLimit } from "../lib/rateLimit.ts";
import {
  applyPaymentSuccess,
  expireUnpaidOrders,
  getOrderDoc,
  normalizeOrderNumber,
  placeOrder,
  publicOrder,
  startPayment,
  type OrderDoc,
} from "../services/orders.ts";
import { listPublicProductsCached } from "../services/catalog.ts";
import { getSiteSettings } from "../services/site.ts";
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
  // Only a name and phone number are asked for; the address is needed for delivery only.
  // Bots tend to fill every field; people never see this one.
  website: z.string().max(200).optional(),
  turnstileToken: z.string().max(4096).optional(),
  customer: z.object({
    name: z.string().trim().min(2, "Enter your full name.").max(120),
    phone: z
      .string()
      .trim()
      .max(30)
      .regex(/^\+?[0-9][0-9 ()-]{6,}$/, "Enter a phone number we can reach you on."),
    address: z.string().trim().max(300).optional(),
  }),
});

async function verifyChallenge(config: Deps["config"], token: string | undefined, ip: string | undefined) {
  if (!token) throw new ApiError(403, "challenge_failed", "Please complete the security check and try again.");
  try {
    const response = await fetch(config.turnstileVerifyUrl, {
      method: "POST",
      body: new URLSearchParams({ secret: config.turnstileSecretKey!, response: token, ...(ip ? { remoteip: ip } : {}) }),
      signal: AbortSignal.timeout(8000),
    });
    const result = (await response.json()) as { success?: boolean };
    if (result.success) return;
  } catch (error) {
    console.error("Turnstile verification failed", error);
  }
  throw new ApiError(403, "challenge_failed", "Please complete the security check and try again.");
}

// Public catalogue reads can be cached briefly by browsers and the Hosting CDN.
const CACHE_PUBLIC = "public, max-age=30, s-maxage=60";
// File names are unique per upload and never reused, so media can be cached for a day.
// Unpublishing or deleting an item therefore takes up to a day to disappear from the CDN.
const MEDIA_CACHE = "public, max-age=86400, s-maxage=86400";

function searchText(product: Product) {
  return fold(
    [product.house, product.name, product.family, product.shortDescription, ...product.notes.top, ...product.notes.heart, ...product.notes.base].join(" "),
  );
}

export function publicRoutes(deps: Deps) {
  const { store, config } = deps;
  const app = new Hono<AppEnv>();

  app.get("/api/v1/health", (c) => c.json({ ok: true, checkoutEnabled: config.checkoutEnabled, payments: deps.payments.name }));

  // The catalogue is small (tens to low hundreds of products), so published
  // products are loaded and filtered in memory; Firestore has no substring search.
  app.get("/api/v1/products", async (c) => {
    const query = parse(listQuery, c.req.query());
    const needle = fold(query.query);
    const family = fold(query.family);
    const matches = (await listPublicProductsCached(store, config.catalogCacheMs, listPublicProducts))
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

  // Contact details and banner text. Cached at the CDN; the storefront asks once per visit.
  app.get("/api/v1/site", async (c) => {
    const site = await getSiteSettings(store);
    c.header("Cache-Control", "public, max-age=60, s-maxage=300");
    return c.json(site);
  });

  app.get("/api/v1/families", async (c) => {
    const counts = new Map<string, number>();
    for (const product of await listPublicProductsCached(store, config.catalogCacheMs, listPublicProducts)) counts.set(product.family, (counts.get(product.family) ?? 0) + 1);
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
  app.use("/api/v1/orders", rateLimit(config.rateLimitOrdersPerMin));
  app.use("/api/v1/track/*", rateLimit(config.rateLimitTrackPerMin));
  app.use("/api/v1/payments/*", rateLimit(config.rateLimitTrackPerMin * 5));

  app.post("/api/v1/orders", async (c) => {
    if (!config.checkoutEnabled) {
      throw new ApiError(503, "checkout_unavailable", "Online checkout is not open yet.");
    }
    const body = await readJson(c, orderBody);
    if (body.website) throw new ApiError(422, "invalid_request", "Your order could not be placed.");
    if (config.turnstileSecretKey) await verifyChallenge(config, body.turnstileToken, c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for")?.split(",")[0]?.trim());
    const { order, payment } = await placeOrder(store, deps.payments, config, body);
    c.header("Cache-Control", "no-store");
    return c.json(
      {
        order: {
          number: order.number,
          status: order.status,
          fulfilmentMethod: order.fulfilmentMethod ?? "delivery",
          deliveryLabel: order.deliveryLabel,
          deliveryMinor: order.deliveryMinor,
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
        payment: {
          provider: payment.provider,
          status: payment.status,
          reference: payment.reference,
          authorizationUrl: payment.authorizationUrl,
          message: payment.message,
        },
      },
      201,
    );
  });

  // The order number is the customer's only key, so it is long enough to be unguessable
  // and every miss looks the same.
  async function findPublicOrder(rawNumber: string) {
    const number = normalizeOrderNumber(rawNumber);
    const snapshot = await store.db.collection(COLLECTIONS.orders).where("number", "==", number).limit(1).get();
    const doc = snapshot.docs[0];
    if (!doc || (doc.data() as OrderDoc).isSample) throw notFound("Order");
    return doc.id;
  }

  // Looks up an order's status. If it is still waiting for payment, ask Paystack first,
  // so a customer coming back from paying sees the result even if the webhook is late.
  async function refreshedOrder(id: string) {
    let order = await getOrderDoc(store, id);
    const payments = deps.payments;
    if (payments.online && order.status === "pending_payment") {
      for (const reference of [...(order.paymentReferences ?? [])].reverse().slice(0, 3)) {
        try {
          const check = await payments.verify(reference);
          if (check.status === "success") {
            await applyPaymentSuccess(store, { reference, amountMinor: check.amountMinor, currency: check.currency });
            break;
          }
        } catch (error) {
          console.error("Payment verification failed", error);
          break;
        }
      }
      order = await getOrderDoc(store, id);
      if (order.status === "pending_payment" && Date.now() - Date.parse(order.createdAt) > config.unpaidOrderMinutes * 60_000) {
        await expireUnpaidOrders(store, config.unpaidOrderMinutes);
        order = await getOrderDoc(store, id);
      }
    }
    return { id, ...order };
  }

  app.get("/api/v1/track/:number", async (c) => {
    const id = await findPublicOrder(c.req.param("number"));
    c.header("Cache-Control", "no-store");
    return c.json(publicOrder(await refreshedOrder(id), deps.payments.online));
  });

  // Starts a fresh payment attempt for an order that is still unpaid.
  app.post("/api/v1/track/:number/pay", async (c) => {
    const id = await findPublicOrder(c.req.param("number"));
    const order = await refreshedOrder(id);
    if (!deps.payments.online || order.status !== "pending_payment") {
      throw new ApiError(409, "not_payable", "This order doesn't need a payment right now.");
    }
    const payment = await startPayment(store, deps.payments, config, id);
    c.header("Cache-Control", "no-store");
    return c.json({ payment: { status: payment.status, authorizationUrl: payment.authorizationUrl, message: payment.message } });
  });

  // Paystack calls this when a charge succeeds. The signature is checked on the raw
  // body; anything unsigned is refused. Always answer 200 to a signed event so it is
  // not retried for no reason.
  app.post("/api/v1/payments/paystack/webhook", async (c) => {
    const raw = await c.req.text();
    if (!deps.payments.verifyWebhook(raw, c.req.header("x-paystack-signature"))) {
      throw new ApiError(401, "bad_signature", "Signature check failed.");
    }
    let event: { event?: string; data?: { status?: string; reference?: string; amount?: number; currency?: string } };
    try {
      event = JSON.parse(raw);
    } catch {
      return c.json({ ok: true });
    }
    const data = event.data;
    if (event.event === "charge.success" && data?.status === "success" && data.reference) {
      await applyPaymentSuccess(store, { reference: data.reference, amountMinor: Number(data.amount ?? 0), currency: String(data.currency ?? "") });
    }
    return c.json({ ok: true });
  });

  // Serves an image only while it is approved and attached to something published.
  app.get("/media/:file", async (c) => {
    const file = c.req.param("file");
    if (!MEDIA_FILE.test(file)) throw notFound("Image");
    // Product media is by far the common case, so ask about content only if it misses.
    // That keeps a cache-missing media request to a single Firestore read.
    const products = await store.db.collection(COLLECTIONS.products).where("publicFiles", "array-contains", file).limit(1).get();
    if (products.empty) {
      const content = await store.db.collection(COLLECTIONS.content).where("publicFiles", "array-contains", file).limit(1).get();
      if (content.empty) throw notFound("Image");
    }
    const response = await mediaResponse(store.bucket, file, c.req.header("range"), MEDIA_CACHE, {
      "Cross-Origin-Resource-Policy": "cross-origin",
    });
    if (!response) throw notFound("Image");
    return response;
  });

  return app;
}
