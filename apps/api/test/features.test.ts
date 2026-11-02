import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { after, before, describe, test } from "node:test";
import { createApp } from "../src/app.ts";
import { createAdmin } from "../src/routes/admin/users.ts";
import type { PaymentAdapter } from "../src/services/payments.ts";
import { call, createPublishedProduct, login, setup } from "./helpers.ts";

const SHELL = `<!doctype html><html lang="en"><head><meta charset="UTF-8" /><meta name="description" content="Generic" /><title>Esspor Decants — Essence, Portioned</title></head><body><div id="root"></div></body></html>`;

// An online adapter that never touches the network, to exercise the rules around it.
const onlinePayments: PaymentAdapter = {
  name: "test-online",
  online: true,
  async initialize(request) {
    return { provider: "test-online", status: "pending", reference: `${request.number}-x`, authorizationUrl: `https://pay.test/${request.number}`, message: "ok" };
  },
  async verify() {
    return { status: "pending", amountMinor: 0, currency: "GHS" };
  },
  verifyWebhook: () => false,
};

describe("Store details, abuse guards, exports, import and link previews", () => {
  let ctx: Awaited<ReturnType<typeof setup>>;
  let app: ReturnType<typeof createApp>;
  let admin: Awaited<ReturnType<typeof login>>["admin"];
  let variantId = "";
  let slug = "";
  const challenge = { server: undefined as unknown as Server, verdict: true, seen: [] as string[] };

  before(async () => {
    await new Promise<void>((resolve) => {
      challenge.server = createServer((req, res) => {
        let raw = "";
        req.on("data", (chunk) => (raw += chunk));
        req.on("end", () => {
          challenge.seen.push(raw);
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ success: challenge.verdict && raw.includes("good-token") }));
        });
      }).listen(0, "127.0.0.1", resolve);
    });
    const { port } = challenge.server.address() as { port: number };
    ctx = await setup({ checkoutEnabled: true, siteUrl: "https://shop.test", turnstileVerifyUrl: `http://127.0.0.1:${port}/` });
    app = createApp({ store: ctx.store, config: ctx.config, fetchShell: async () => ({ html: SHELL, headers: { "content-security-policy": "default-src 'self'" } }) });
    admin = (await login(app)).admin;
    const made = await createPublishedProduct(admin, 20, "Cèdre Lumière");
    variantId = made.variantId;
    slug = (await admin("GET", `/products/${made.productId}`)).data.slug;
    await admin("POST", "/delivery-options", { body: { code: "pickup", label: "Pickup", priceMinor: 0, method: "pickup", active: true } });
  });
  after(() => challenge.server.close());

  const order = (target: ReturnType<typeof createApp>, extra: Record<string, unknown> = {}, name = "Ama Mensah", phone = "024 555 0100") =>
    call(target, "POST", "/api/v1/orders", {
      body: { items: [{ variantId, quantity: 1 }], deliveryOptionCode: "pickup", customer: { name, phone }, ...extra },
    });

  test("store details are public, editable by the owner only, and normalised", async () => {
    const before = await call(app, "GET", "/api/v1/site");
    assert.equal(before.data.announcement, "Order before 8PM for next-day delivery | Mon–Fri");
    assert.equal(before.data.whatsapp, "");
    const saved = await admin("PUT", "/site", {
      body: { businessName: "Esspor Decants", announcement: "Order before 8PM for next-day delivery | Mon–Fri", whatsapp: "024 555 0199", phone: "+233 24 555 0199", email: "hello@esspor.test", instagram: "https://www.instagram.com/esspor.gh/", pickupNote: "Osu, Accra. Weekdays 10 to 6." },
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    assert.equal(saved.data.whatsapp, "233245550199", "a local number becomes international digits");
    assert.equal(saved.data.instagram, "esspor.gh");
    const bad = await admin("PUT", "/site", { body: { ...saved.data, email: "not-an-email" } });
    assert.equal(bad.status, 400);

    await createAdmin(ctx.store, { email: "editor@test.local", name: "Ed", role: "editor", password: "editor-password-1" });
    const editor = await login(app, "editor@test.local", "editor-password-1");
    assert.equal((await editor.admin("PUT", "/site", { body: saved.data })).status, 403);
    assert.equal((await call(app, "GET", "/api/v1/site")).data.whatsapp, "233245550199");
  });

  test("a customer-visible note appears on Track order but internal notes never do", async () => {
    const placed = await order(app);
    assert.equal(placed.status, 201, JSON.stringify(placed.data));
    const id = (await admin("GET", "/orders")).data.items.find((item: { number: string }) => item.number === placed.data.order.number).id;
    await admin("PATCH", `/orders/${id}`, { body: { publicNote: "Rider Kwesi, 024 000 1111. Arriving after 2pm.", internalNotes: "Customer is a friend, give a discount." } });
    const tracked = await call(app, "GET", `/api/v1/track/${placed.data.order.number}`);
    assert.equal(tracked.data.note, "Rider Kwesi, 024 000 1111. Arriving after 2pm.");
    assert.ok(!JSON.stringify(tracked.data).includes("discount"));
    const forbidden = await admin("PATCH", `/orders/${id}`, { body: { publicNote: "x".repeat(301) } });
    assert.equal(forbidden.status, 400);
  });

  test("the honeypot and the security check stop bots; real checks pass", async () => {
    const trapped = await order(app, { website: "http://spam.example" }, "Bot", "024 555 0101");
    assert.equal(trapped.status, 422);

    const secured = createApp({ store: ctx.store, config: { ...ctx.config, turnstileSecretKey: "turnstile-secret" } });
    const missing = await order(secured, {}, "No Token", "024 555 0102");
    assert.equal(missing.status, 403);
    assert.equal(missing.data.error.code, "challenge_failed");
    const wrong = await order(secured, { turnstileToken: "bad-token" }, "Bad Token", "024 555 0103");
    assert.equal(wrong.status, 403);
    const fine = await order(secured, { turnstileToken: "good-token" }, "Good Token", "024 555 0104");
    assert.equal(fine.status, 201, JSON.stringify(fine.data));
    assert.ok(challenge.seen.some((body) => body.includes("secret=turnstile-secret") && body.includes("response=good-token")));
  });

  test("one phone number can only hold a few unpaid online orders", async () => {
    const online = createApp({ store: ctx.store, config: ctx.config, payments: onlinePayments });
    const statuses: number[] = [];
    for (const phone of ["024 555 0300", "+233 24 555 0300", "0245550300", "024-555-0300"]) statuses.push((await order(online, {}, "Kwame Hoarder", phone)).status);
    assert.deepEqual(statuses, [201, 201, 201, 429], "three different ways of typing one number count as one buyer");
    assert.equal((await order(online, {}, "Someone Else", "024 555 0301")).status, 201);
  });

  test("orders export as a spreadsheet, with formulas defused, and the attention count tracks paid orders", async () => {
    await order(app, {}, "=HYPERLINK(\"http://evil.test\",\"click\")", "+233 20 111 2222");
    const csv = await call(app, "GET", "/api/admin/orders/export", { headers: { authorization: `Bearer ${(await login(app)).token}` } });
    assert.equal(csv.status, 200);
    assert.match(csv.headers.get("content-type") ?? "", /text\/csv/);
    assert.match(csv.headers.get("content-disposition") ?? "", /esspor-orders-\d{4}-\d{2}-\d{2}\.csv/);
    const text = Buffer.from(csv.data).toString("utf8");
    assert.ok(text.includes("'=HYPERLINK"), "a cell starting with = is prefixed so it cannot run");
    assert.ok(!/(^|,)=HYPERLINK/m.test(text));
    assert.ok(text.includes("+233 20 111 2222"), "plain phone numbers stay readable");

    const attention = await admin("GET", "/orders/attention");
    assert.equal(attention.status, 200);
    assert.ok(attention.data.count >= 1, "with payment by phone, unpaid orders need a call");
    const online = createApp({ store: ctx.store, config: ctx.config, payments: onlinePayments });
    const onlineAdmin = (await login(online)).admin;
    const onlineAttention = await onlineAdmin("GET", "/orders/attention");
    assert.equal(onlineAttention.data.count, 0, "with online payment only paid orders need action");
  });

  test("the overview reports sales for the last 30 days", async () => {
    const id = (await admin("GET", "/orders")).data.items[0].id;
    await admin("POST", `/orders/${id}/status`, { body: { status: "paid" } });
    const summary = await admin("GET", "/summary");
    assert.ok(summary.data.sales.last30Days.orders >= 1);
    assert.ok(summary.data.sales.last30Days.revenueMinor >= 12000);
  });

  test("bulk import checks first, creates drafts only, and never overwrites", async () => {
    const rows = [
      { house: "Lattafa", name: "Khamrah", concentration: "Eau de Parfum", family: "Gourmand", shortDescription: "Warm spice and dates.", notesTop: "Cinnamon; Nutmeg", sku: "LAT-KHA-5", sizeMl: "5", priceGhs: "85", stock: "10" },
      { house: "Lattafa", name: "Khamrah", sku: "LAT-KHA-10", sizeMl: "10", priceGhs: "150", stock: "6" },
      { house: "Maison Verité", name: "Cèdre Lumière", sku: "DUP-1", sizeMl: "5", priceGhs: "100" },
      { house: "Broken", name: "Row", sku: "BR", sizeMl: "five", priceGhs: "-1" },
      { house: "Dupe", name: "Sku", sku: "LAT-KHA-5", sizeMl: "5", priceGhs: "10" },
    ];
    const dry = await admin("POST", "/products/import", { body: { rows, dryRun: true } });
    assert.equal(dry.status, 200, JSON.stringify(dry.data));
    assert.equal(dry.data.dryRun, true);
    assert.deepEqual(dry.data.created.map((p: { name: string; sizes: number }) => [p.name, p.sizes]), [["Khamrah", 2]]);
    assert.ok(dry.data.skipped.some((p: { name: string; reason: string }) => p.name === "Cèdre Lumière" && /already exists/.test(p.reason)));
    assert.ok(dry.data.errors.some((e: { row: number }) => e.row === 5), "bad numbers are reported with their row");
    assert.ok(dry.data.errors.some((e: { row: number; message: string }) => e.row === 6 && /already used/.test(e.message)));
    assert.equal((await admin("GET", "/products?q=khamrah")).data.items.length, 0, "a dry run saves nothing");

    const real = await admin("POST", "/products/import", { body: { rows, dryRun: false } });
    assert.equal(real.data.created.length, 1);
    const found = (await admin("GET", "/products?q=khamrah")).data.items;
    assert.equal(found.length, 1);
    const product = (await admin("GET", `/products/${found[0].id}`)).data;
    assert.equal(product.status, "draft", "imported products are never published");
    assert.equal(product.variants.length, 2);
    assert.equal(product.variants.find((v: { sizeMl: number }) => v.sizeMl === 5).priceMinor, 8500);
    assert.deepEqual(product.notes.top, ["Cinnamon", "Nutmeg"]);
    assert.equal(product.publishable, false);
    const again = await admin("POST", "/products/import", { body: { rows: rows.slice(0, 2), dryRun: false } });
    assert.equal(again.data.created.length, 0, "importing the same rows again creates nothing");
    assert.equal((await admin("POST", "/products/import", { body: { rows: [], dryRun: true } })).status, 400);
  });

  test("a shared product link carries its own title, image and price; unknown ones are real 404s", async () => {
    const page = await call(app, "GET", `/product/${slug}`);
    assert.equal(page.status, 200);
    const html = Buffer.from(page.data).toString("utf8");
    assert.match(html, /<title>Cèdre Lumière by Maison Verité/);
    assert.ok(html.includes(`<link rel="canonical" href="https://shop.test/product/${slug}" />`));
    assert.match(html, /<meta property="og:image" content="http:\/\/api\.test\/media\/[0-9a-f-]+\.png" \/>/);
    assert.ok(html.includes('"priceCurrency":"GHS"') && html.includes('"lowPrice":"120.00"'));
    assert.ok(!html.includes('content="Generic"'), "the generic description is replaced");
    assert.equal(page.headers.get("cache-control"), "public, max-age=0, s-maxage=300");
    assert.equal(page.headers.get("content-security-policy"), "default-src 'self'", "the static page's security headers are passed on");

    const missing = await call(app, "GET", "/product/not-a-real-scent");
    assert.equal(missing.status, 404);
    assert.ok(Buffer.from(missing.data).toString("utf8").includes('<meta name="robots" content="noindex" />'));

    const down = createApp({ store: ctx.store, config: ctx.config, fetchShell: async () => { throw new Error("offline"); } });
    assert.equal((await call(down, "GET", `/product/${slug}`)).status, 503);

    const sitemap = Buffer.from((await call(app, "GET", "/sitemap.xml")).data).toString("utf8");
    assert.ok(sitemap.includes(`https://shop.test/product/${slug}`) && sitemap.includes("https://shop.test/privacy"));
  });
});
