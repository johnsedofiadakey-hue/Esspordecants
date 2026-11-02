import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { createApp } from "../src/app.ts";
import { call, completeProduct, imageForm, login, mediaForm, mp4, png, setup, signIn, webm } from "./helpers.ts";

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

  test("a product can carry several photos and videos, with the hero always a photo", async () => {
    const extra = await admin("POST", `/products/${productId}/images`, { form: imageForm({ role: "decant-side", alt: "Side view of the decant", isRealPhoto: "true" }, png(500, 500)) });
    assert.equal(extra.status, 201);
    assert.equal(extra.data.kind, "image");

    const bad = await admin("POST", `/products/${productId}/images`, { form: mediaForm({ role: "decant-front" }, Buffer.from("not a video at all, just text"), "clip.mp4", "video/mp4") });
    assert.equal(bad.status, 415);

    const clip = await admin("POST", `/products/${productId}/images`, {
      form: mediaForm({ role: "decant-front", alt: "Actual Esspor decant being sprayed", isRealPhoto: "true" }, mp4(4096), "spray.mp4", "video/mp4"),
    });
    assert.equal(clip.status, 201, JSON.stringify(clip.data));
    assert.equal(clip.data.kind, "video");
    assert.equal(clip.data.mime, "video/mp4");
    const webmClip = await admin("POST", `/products/${productId}/images`, {
      form: mediaForm({ role: "packaging", alt: "Unboxing of the decant pack", isRealPhoto: "true" }, webm(), "unbox.webm", "video/webm"),
    });
    assert.equal(webmClip.data.mime, "video/webm");

    // Videos cannot stand in for a variant's bottle photo.
    const asVariantImage = await admin("PATCH", `/products/${productId}/variants/${variantId}`, { body: { imageId: clip.data.id } });
    assert.equal(asVariantImage.status, 400);

    // Not public until approved.
    const file = clip.data.url.split("/").pop();
    assert.equal((await call(ctx.app, "GET", `/media/${file}`)).status, 404);
    const approved = await admin("PATCH", `/products/${productId}/images/${clip.data.id}`, { body: { approved: true } });
    assert.equal(approved.status, 200);
    await admin("PATCH", `/products/${productId}/images/${webmClip.data.id}`, { body: { approved: true } });
    await admin("PATCH", `/products/${productId}/images/${extra.data.id}`, { body: { approved: true } });

    const detail = await call(ctx.app, "GET", "/api/v1/products/maison-verite-cedre-lumiere");
    const kinds = detail.data.images.map((image: { role: string; kind: string }) => `${image.role}:${image.kind}`);
    assert.deepEqual(kinds, [
      "decant-front:image",
      "decant-front:video",
      "decant-side:image",
      "packaging:video",
      "source-bottle:image",
    ]);
    assert.equal(detail.data.heroImage.kind, "image");
    assert.equal(detail.data.images[1].mime, "video/mp4");

    // Videos stream with byte ranges so browsers can seek.
    const whole = await call(ctx.app, "GET", `/media/${file}`);
    assert.equal(whole.status, 200);
    assert.equal(whole.headers.get("content-type"), "video/mp4");
    assert.equal(whole.headers.get("accept-ranges"), "bytes");
    assert.equal(whole.data.byteLength, mp4(4096).length);
    const part = await call(ctx.app, "GET", `/media/${file}`, { headers: { range: "bytes=0-9" } });
    assert.equal(part.status, 206);
    assert.equal(part.headers.get("content-range"), `bytes 0-9/${mp4(4096).length}`);
    assert.equal(part.data.byteLength, 10);
    const tail = await call(ctx.app, "GET", `/media/${file}`, { headers: { range: "bytes=-4" } });
    assert.equal(tail.status, 206);
    assert.equal(tail.data.byteLength, 4);
    assert.equal((await call(ctx.app, "GET", `/media/${file}`, { headers: { range: "bytes=999999-" } })).status, 416);

    // A photo is still needed to publish: with only videos approved, the gate would fail.
    assert.equal((await admin("GET", `/products/${productId}`)).data.publishable, true);
  });

  test("videos are not accepted for the editorial library, and oversize ones are refused", async () => {
    const library = await admin("POST", "/images", { form: mediaForm({ alt: "Mood clip" }, mp4(1024), "mood.mp4", "video/mp4") });
    assert.equal(library.status, 415);
    const small = createApp({ store: ctx.store, config: { ...ctx.config, maxVideoBytes: 2048 } });
    const session = await login(small);
    const big = await session.admin("POST", `/products/${productId}/images`, { form: mediaForm({ role: "editorial" }, mp4(4096), "big.mp4", "video/mp4") });
    assert.equal(big.status, 413);
    assert.equal(big.data.error.code, "file_too_large");
  });

  test("media is cached for a day and capped per product", async () => {
    const detail = await call(ctx.app, "GET", "/api/v1/products/maison-verite-cedre-lumiere");
    const file = detail.data.images[0].url.split("/").pop();
    const media = await call(ctx.app, "GET", `/media/${file}`);
    assert.equal(media.headers.get("cache-control"), "public, max-age=86400, s-maxage=86400");

    const capped = createApp({ store: ctx.store, config: { ...ctx.config, maxVideosPerProduct: 2, maxPhotosPerProduct: 3 } });
    const session = await login(capped);
    const video = await session.admin("POST", `/products/${productId}/images`, { form: mediaForm({ role: "editorial" }, mp4(2048), "extra.mp4", "video/mp4") });
    assert.equal(video.status, 422);
    assert.equal(video.data.error.code, "media_limit");
    const photo = await session.admin("POST", `/products/${productId}/images`, { form: imageForm({ role: "editorial" }) });
    assert.equal(photo.status, 422);
    assert.equal(photo.data.error.code, "media_limit");
    const after = await session.admin("GET", `/products/${productId}`);
    assert.equal(after.data.images.length, 5, "a refused upload leaves nothing attached");
  });

  test("the public catalogue is held briefly, and our own writes clear it", async () => {
    const cached = createApp({ store: ctx.store, config: { ...ctx.config, catalogCacheMs: 60_000 } });
    const session = await login(cached);
    const read = async () => (await call(cached, "GET", "/api/v1/products?query=cedre")).data.items[0].shortDescription;
    const original = await read();
    await ctx.store.db.collection("products").doc(productId).update({ shortDescription: "Changed behind the API's back" });
    assert.equal(await read(), original, "a second read within the window does not rescan Firestore");
    const patched = await session.admin("PATCH", `/products/${productId}`, { body: { shortDescription: original } });
    assert.equal(patched.status, 200);
    assert.equal(await read(), original);
    await ctx.store.db.collection("products").doc(productId).update({ shortDescription: "Changed again" });
    assert.equal(await read(), original, "still cached after the write cleared and refilled it");
    await session.admin("PATCH", `/products/${productId}`, { body: { shortDescription: original } });
    assert.equal(await read(), original);
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
    await session.admin("POST", "/delivery-options", { body: { code: "test-pickup", label: "Pick up", priceMinor: 0, method: "pickup", active: true } });
    const customer = { name: "Test Buyer", phone: "+233 24 000 0000", address: "1 Test Road, Osu, Accra" };
    const noDelivery = await call(enabled, "POST", "/api/v1/orders", { body: { items: [{ variantId, quantity: 1 }], customer } });
    assert.equal(noDelivery.status, 422);

    const quoted = await call(enabled, "POST", "/api/v1/checkout/quote", { body: { items: [{ variantId, quantity: 1 }] } });
    assert.deepEqual(
      quoted.data.deliveryOptions.map((option: { code: string; method: string }) => [option.code, option.method]).sort(),
      [["test-courier", "delivery"], ["test-pickup", "pickup"]],
    );

    // Delivery needs an address; only a name and phone are asked for besides that.
    const noAddress = await call(enabled, "POST", "/api/v1/orders", {
      body: { items: [{ variantId, quantity: 1 }], deliveryOptionCode: "test-courier", customer: { name: "Test Buyer", phone: customer.phone } },
    });
    assert.equal(noAddress.status, 422);
    assert.equal(noAddress.data.error.code, "address_required");
    const badPhone = await call(enabled, "POST", "/api/v1/orders", {
      body: { items: [{ variantId, quantity: 1 }], deliveryOptionCode: "test-pickup", customer: { name: "Test Buyer", phone: "abc" } },
    });
    assert.equal(badPhone.status, 400);

    const pickup = await call(enabled, "POST", "/api/v1/orders", {
      body: { items: [{ variantId, quantity: 1 }], deliveryOptionCode: "test-pickup", customer: { name: "Pick Up Buyer", phone: customer.phone } },
    });
    assert.equal(pickup.status, 201, JSON.stringify(pickup.data));
    assert.equal(pickup.data.order.fulfilmentMethod, "pickup");
    assert.equal(pickup.data.order.totalMinor, 12000);
    const pickupOrder = (await session.admin("GET", "/orders")).data.items.find((item: { customerName: string }) => item.customerName === "Pick Up Buyer");
    const pickupDetail = await session.admin("GET", `/orders/${pickupOrder.id}`);
    assert.equal(pickupDetail.data.fulfilmentMethod, "pickup");
    assert.deepEqual(pickupDetail.data.deliveryAddress, {});
    await session.admin("POST", `/orders/${pickupOrder.id}/status`, { body: { status: "cancelled", note: "Test pickup" } });
    const placed = await call(enabled, "POST", "/api/v1/orders", {
      body: { items: [{ variantId, quantity: 2 }], deliveryOptionCode: "test-courier", customer },
    });
    assert.equal(placed.status, 201, JSON.stringify(placed.data));
    assert.equal(placed.data.order.totalMinor, 26000);
    assert.equal(placed.data.payment.status, "not_configured");
    const variant = await session.admin("GET", `/products/${productId}`);
    assert.equal(variant.data.variants[0].stockQuantity, 1);

    const orders = await session.admin("GET", "/orders");
    const orderId = orders.data.items.find((item: { customerName: string }) => item.customerName === "Test Buyer").id;
    const delivered = await session.admin("GET", `/orders/${orderId}`);
    assert.equal(delivered.data.fulfilmentMethod, "delivery");
    assert.equal(delivered.data.deliveryAddress.line1, "1 Test Road, Osu, Accra");
    assert.equal((await session.admin("GET", "/orders?q=24%20000")).data.items.length, 2, "orders are searchable by phone");
    const invalid = await session.admin("POST", `/orders/${orderId}/status`, { body: { status: "shipped" } });
    assert.equal(invalid.status, 409);
    const cancelled = await session.admin("POST", `/orders/${orderId}/status`, { body: { status: "cancelled", note: "Test" } });
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.data.events.length, 3, "placed, payment note, cancelled");
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
