import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { createApp } from "../src/app.ts";
import { call, completeProduct, imageForm, login, png, setup, signIn } from "./helpers.ts";

describe("Esspor API", () => {
  let ctx: Awaited<ReturnType<typeof setup>>;
  let admin: Awaited<ReturnType<typeof login>>["admin"];
  let productId = "";
  let variantId = "";
  let frontFile = "";

  before(async () => {
    ctx = await setup();
    admin = (await login(ctx.app)).admin;
  });

  test("public catalog starts empty", async () => {
    const res = await call(ctx.app, "GET", "/api/v1/products");
    assert.equal(res.status, 200);
    assert.deepEqual(res.data, { items: [], page: 1, pageSize: 12, total: 0 });
  });

  test("admin routes require a valid ID token from an admin account", async () => {
    assert.equal((await call(ctx.app, "GET", "/api/admin/products")).status, 401);
    const forged = await call(ctx.app, "GET", "/api/admin/products", { headers: { authorization: "Bearer not-a-token" } });
    assert.equal(forged.status, 401);
    // A Firebase user without an admins record (e.g. self-registered) gets nothing.
    await ctx.store.auth.createUser({ email: "stranger@test.local", password: "stranger-password-1" });
    const stranger = await signIn("stranger@test.local", "stranger-password-1");
    const res = await call(ctx.app, "GET", "/api/admin/products", { headers: { authorization: `Bearer ${stranger.token}` } });
    assert.equal(res.status, 403);
    assert.equal(res.data.error.code, "not_an_admin");
  });

  test("draft product cannot publish until gates pass", async () => {
    const created = await admin("POST", "/products", { body: { house: "Maison Verité", name: "Cèdre Lumière" } });
    assert.equal(created.status, 201);
    assert.equal(created.data.slug, "maison-verite-cedre-lumiere");
    assert.equal(created.data.status, "draft");
    productId = created.data.id;
    const publish = await admin("POST", `/products/${productId}/publish`);
    assert.equal(publish.status, 422);
    assert.equal(publish.data.error.code, "publish_gate_failed");
    const failing = publish.data.error.details.map((check: { code: string }) => check.code);
    assert.ok(failing.includes("decant_photo"));
    assert.ok(failing.includes("variant"));
  });

  test("uploads are sniffed and size-checked", async () => {
    const fake = await admin("POST", `/products/${productId}/images`, { form: imageForm({ role: "decant-front" }, Buffer.from("not an image")) });
    assert.equal(fake.status, 415);
    const tiny = await admin("POST", `/products/${productId}/images`, { form: imageForm({ role: "decant-front" }, png(100, 100)) });
    assert.equal(tiny.status, 422);
  });

  test("image approval requires real-photo attestation and alt text", async () => {
    const up = await admin("POST", `/products/${productId}/images`, { form: imageForm({ role: "decant-front", alt: "x" }) });
    assert.equal(up.status, 201);
    assert.equal(up.data.approved, false);
    assert.equal(up.data.width, 480);
    frontFile = up.data.url.split("/").pop();
    const rejected = await admin("PATCH", `/products/${productId}/images/${up.data.id}`, { body: { approved: true } });
    assert.equal(rejected.status, 422);
    const ok = await admin("PATCH", `/products/${productId}/images/${up.data.id}`, {
      body: { alt: "Actual 5 ml Esspor decant, front view", isRealPhoto: true, approved: true },
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.data.approved, true);

    const source = await admin("POST", `/products/${productId}/images`, {
      form: imageForm({ role: "source-bottle", alt: "Perfume", isRealPhoto: "true" }),
    });
    const badAlt = await admin("PATCH", `/products/${productId}/images/${source.data.id}`, { body: { approved: true } });
    assert.equal(badAlt.status, 422, "source-bottle alt must say it is the original bottle");
    const goodAlt = await admin("PATCH", `/products/${productId}/images/${source.data.id}`, {
      body: { alt: "Original full-size source bottle", approved: true },
    });
    assert.equal(goodAlt.status, 200);
  });

  test("variants, copy and physical spec unlock publishing", async () => {
    const variant = await admin("POST", `/products/${productId}/variants`, { body: { sku: "ess-cdl-5", sizeMl: 5, priceMinor: 12000, stockQuantity: 3 } });
    assert.equal(variant.status, 201);
    assert.equal(variant.data.sku, "ESS-CDL-5");
    variantId = variant.data.id;
    const dup = await admin("POST", `/products/${productId}/variants`, { body: { sku: "ESS-CDL-5", sizeMl: 10 } });
    assert.equal(dup.status, 409);
    const patched = await admin("PATCH", `/products/${productId}`, { body: completeProduct });
    assert.equal(patched.status, 200);
    assert.equal(patched.data.publishable, true, JSON.stringify(patched.data.readiness.filter((c: { ok: boolean }) => !c.ok)));
    const published = await admin("POST", `/products/${productId}/publish`);
    assert.equal(published.status, 200);
    assert.equal(published.data.status, "published");
  });

  test("published product appears in public reads with decant first", async () => {
    const accentless = await call(ctx.app, "GET", "/api/v1/products?query=cedre%20lumiere");
    assert.equal(accentless.data.total, 1, "search ignores accents");
    const byNote = await call(ctx.app, "GET", "/api/v1/products?query=MUSK");
    assert.equal(byNote.data.total, 1, "search covers notes, case-insensitively");
    const literal = await call(ctx.app, "GET", "/api/v1/products?query=%25");
    assert.equal(literal.data.total, 0, "search is literal");
    const byHouse = await call(ctx.app, "GET", "/api/v1/products?query=Verit&family=woody");
    assert.equal(byHouse.data.total, 1);
    const item = byHouse.data.items[0];
    assert.equal(item.heroImage.role, "decant-front");
    assert.equal(item.minPriceMinor, 12000);
    assert.equal(item.available, true);
    assert.ok(item.heroImage.url.startsWith("http://api.test/media/"));

    const detail = await call(ctx.app, "GET", `/api/v1/products/${item.slug}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.data.images[0].role, "decant-front");
    const source = detail.data.images.find((image: { role: string }) => image.role === "source-bottle");
    assert.ok(source.caption.includes("Original"));
    assert.equal(detail.data.variants[0].stockStatus, "low_stock");
    assert.deepEqual(Object.keys(detail.data).sort(), [
      "authenticityCopy", "available", "concentration", "currency", "description", "family", "heroImage", "house", "id",
      "images", "minPriceMinor", "name", "notes", "shortDescription", "slug", "sourceBrand", "status", "variants", "whatArrives",
    ]);

    const media = await call(ctx.app, "GET", `/media/${frontFile}`);
    assert.equal(media.status, 200);
    assert.equal(media.headers.get("content-type"), "image/png");
    const families = await call(ctx.app, "GET", "/api/v1/families");
    assert.deepEqual(families.data.items, [{ name: "Woody", count: 1 }]);
  });

  test("edits that break a live product are rolled back", async () => {
    const res = await admin("PATCH", `/products/${productId}`, { body: { description: "" } });
    assert.equal(res.status, 422);
    const still = await admin("GET", `/products/${productId}`);
    assert.ok(still.data.description.length > 0);
  });

  test("unapproved images and drafts stay private", async () => {
    const draft = await admin("POST", `/products`, { body: { house: "Hidden", name: "Draft" } });
    const up = await admin("POST", `/products/${draft.data.id}/images`, { form: imageForm({ role: "decant-front" }) });
    const file = up.data.url.split("/").pop();
    assert.equal((await call(ctx.app, "GET", `/media/${file}`)).status, 404);
    assert.equal((await call(ctx.app, "GET", `/api/v1/products/${draft.data.slug}`)).status, 404);
    assert.equal((await admin("GET", `/media/${file}`)).status, 200);
  });

  test("quote uses server prices and stock", async () => {
    const res = await call(ctx.app, "POST", "/api/v1/checkout/quote", {
      body: { items: [{ variantId, quantity: 2 }, { variantId: "missing", quantity: 1 }] },
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.subtotalMinor, 24000);
    assert.equal(res.data.checkoutAvailable, false);
    assert.equal(res.data.errors[0].code, "variant_unavailable");
    const over = await call(ctx.app, "POST", "/api/v1/checkout/quote", { body: { items: [{ variantId, quantity: 4 }] } });
    assert.equal(over.data.errors[0].code, "insufficient_stock");
    assert.equal(over.data.errors[0].availableQuantity, 3);
    assert.equal(over.data.subtotalMinor, 0);
    const tampered = await call(ctx.app, "POST", "/api/v1/checkout/quote", { body: { items: [{ variantId, quantity: 1, priceMinor: 1 }] } });
    assert.equal(tampered.data.items[0].unitPriceMinor, 12000);
  });

  test("order placement is closed while checkout is disabled", async () => {
    const res = await call(ctx.app, "POST", "/api/v1/orders", { body: {} });
    assert.equal(res.status, 503);
    assert.equal(res.data.error.code, "checkout_unavailable");
  });

  test("with checkout enabled, orders reserve stock and cancellation restores it", async () => {
    const enabled = createApp({ store: ctx.store, config: { ...ctx.config, checkoutEnabled: true } });
    const session = await login(enabled);
    await session.admin("POST", "/delivery-options", { body: { code: "test-courier", label: "Test courier", priceMinor: 2000, active: true } });
    const customer = {
      name: "Test Buyer",
      email: "buyer@example.invalid",
      phone: "+233000000000",
      address: { line1: "1 Test Road", city: "Accra", region: "Greater Accra" },
    };
    const noDelivery = await call(enabled, "POST", "/api/v1/orders", { body: { items: [{ variantId, quantity: 1 }], customer } });
    assert.equal(noDelivery.status, 422);
    const placed = await call(enabled, "POST", "/api/v1/orders", {
      body: { items: [{ variantId, quantity: 2 }], deliveryOptionCode: "test-courier", customer },
    });
    assert.equal(placed.status, 201, JSON.stringify(placed.data));
    assert.equal(placed.data.order.totalMinor, 26000);
    assert.equal(placed.data.payment.status, "not_configured");
    const variant = await session.admin("GET", `/products/${productId}`);
    assert.equal(variant.data.variants[0].stockQuantity, 1);

    const orders = await session.admin("GET", "/orders");
    const orderId = orders.data.items[0].id;
    const invalid = await session.admin("POST", `/orders/${orderId}/status`, { body: { status: "shipped" } });
    assert.equal(invalid.status, 409);
    const cancelled = await session.admin("POST", `/orders/${orderId}/status`, { body: { status: "cancelled", note: "Test" } });
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.data.events.length, 2);
    const restored = await session.admin("GET", `/products/${productId}`);
    assert.equal(restored.data.variants[0].stockQuantity, 3);
  });

  test("stock adjustments are logged and cannot go negative", async () => {
    const neg = await admin("POST", `/products/${productId}/variants/${variantId}/stock`, { body: { delta: -10, reason: "Count" } });
    assert.equal(neg.status, 400);
    const ok = await admin("POST", `/products/${productId}/variants/${variantId}/stock`, { body: { delta: 5, reason: "New batch decanted" } });
    assert.equal(ok.data.stockQuantity, 8);
    const log = await admin("GET", `/products/${productId}/variants/${variantId}/stock`);
    assert.equal(log.data.items[0].reason, "New batch decanted");
  });

  test("sample products can never be published", async () => {
    const created = await admin("POST", "/products", { body: { ...completeProduct, name: "Second" } });
    await ctx.store.db.collection("products").doc(created.data.id).update({ isSample: true });
    const res = await admin("POST", `/products/${created.data.id}/publish`);
    assert.equal(res.status, 422);
    assert.ok(res.data.error.details.some((check: { code: string }) => check.code === "not_sample"));
  });

  test("editorial content publishes and is served publicly", async () => {
    const created = await admin("POST", "/content", {
      body: { slug: "our-promise", placement: "home-story", title: "Our promise", body: "Every decant is drawn from an authentic bottle." },
    });
    assert.equal(created.status, 201);
    assert.equal((await call(ctx.app, "GET", "/api/v1/content/our-promise")).status, 404);
    await admin("POST", `/content/${created.data.id}/publish`);
    const list = await call(ctx.app, "GET", "/api/v1/content?placement=home-story");
    assert.equal(list.data.items[0].title, "Our promise");
    const badLink = await admin("PATCH", `/content/${created.data.id}`, { body: { ctaHref: "javascript:alert(1)" } });
    assert.equal(badLink.status, 400);
  });

  test("CORS allows a local storefront origin only for public routes", async () => {
    const pub = await call(ctx.app, "GET", "/api/v1/products", { headers: { origin: "http://localhost:5174" } });
    assert.equal(pub.headers.get("access-control-allow-origin"), "http://localhost:5174");
    const evil = await call(ctx.app, "GET", "/api/v1/products", { headers: { origin: "https://evil.example" } });
    assert.equal(evil.headers.get("access-control-allow-origin"), null);
    const adminRes = await call(ctx.app, "GET", "/api/admin/auth/me", { headers: { origin: "http://localhost:5174" } });
    assert.equal(adminRes.headers.get("access-control-allow-origin"), null);
  });
});
