import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { after, before, describe, test } from "node:test";
import { createApp } from "../src/app.ts";
import { call, createPublishedProduct, login, setup } from "./helpers.ts";

// A stand-in for api.paystack.co: records what we send and answers as we tell it to.
function fakePaystack() {
  const state = {
    initialize: [] as { headers: IncomingMessage["headers"]; body: any }[],
    failInitialize: false,
    verify: new Map<string, { status: string; amount: number; currency: string }>(),
  };
  const server: Server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const json = (code: number, body: unknown) => {
        res.writeHead(code, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };
      if (req.method === "POST" && req.url === "/transaction/initialize") {
        const body = JSON.parse(raw);
        state.initialize.push({ headers: req.headers, body });
        if (state.failInitialize) return json(500, { status: false, message: "boom" });
        return json(200, { status: true, data: { authorization_url: `https://checkout.paystack.test/${body.reference}`, access_code: "ac", reference: body.reference } });
      }
      const verify = req.url?.match(/^\/transaction\/verify\/(.+)$/);
      if (req.method === "GET" && verify) {
        const found = state.verify.get(decodeURIComponent(verify[1]!));
        return found ? json(200, { status: true, data: { reference: verify[1], ...found } }) : json(200, { status: true, data: { status: "abandoned", amount: 0, currency: "GHS" } });
      }
      json(404, { status: false, message: "unknown" });
    });
  });
  return { state, server };
}

const KEY = "sk_test_not_a_real_key";
const sign = (body: string) => createHmac("sha512", KEY).update(body).digest("hex");
const event = (reference: string, amount: number, currency = "GHS") =>
  JSON.stringify({ event: "charge.success", data: { status: "success", reference, amount, currency } });

describe("Paystack payments and order tracking", () => {
  const fake = fakePaystack();
  let ctx: Awaited<ReturnType<typeof setup>>;
  let app: ReturnType<typeof createApp>;
  let admin: Awaited<ReturnType<typeof login>>["admin"];
  let productId = "";
  let variantId = "";
  const customer = { name: "Ama Mensah", phone: "+233 24 123 4567", address: "12 Cantonments Rd, Osu, Accra" };

  const order = async (quantity = 1) => {
    const res = await call(app, "POST", "/api/v1/orders", { body: { items: [{ variantId, quantity }], deliveryOptionCode: "courier", customer } });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    return res.data as { order: { number: string; totalMinor: number }; payment: { status: string; authorizationUrl: string | null; reference: string | null } };
  };
  const track = (number: string) => call(app, "GET", `/api/v1/track/${encodeURIComponent(number)}`);
  const webhook = (body: string, signature = sign(body)) =>
    call(app, "POST", "/api/v1/payments/paystack/webhook", { body: undefined, headers: { "content-type": "application/json", "x-paystack-signature": signature }, raw: body });

  before(async () => {
    await new Promise<void>((resolve) => fake.server.listen(0, "127.0.0.1", resolve));
    const { port } = fake.server.address() as { port: number };
    ctx = await setup({ checkoutEnabled: true, paystackSecretKey: KEY, paystackBaseUrl: `http://127.0.0.1:${port}`, siteUrl: "https://shop.test" });
    app = createApp({ store: ctx.store, config: ctx.config });
    admin = (await login(app)).admin;
    ({ productId, variantId } = await createPublishedProduct(admin, 10));
    await admin("POST", "/delivery-options", { body: { code: "courier", label: "Courier", priceMinor: 2500, method: "delivery", active: true } });
  });
  after(() => fake.server.close());

  test("placing an order starts a Paystack payment with the right amount and a return link", async () => {
    const placed = await order(2);
    assert.match(placed.order.number, /^ESS-\d+-[A-HJ-KM-NP-Z2-9]{4}$/, "numbers carry an unguessable suffix");
    assert.equal(placed.order.totalMinor, 26500);
    assert.equal(placed.payment.status, "pending");
    assert.match(placed.payment.authorizationUrl ?? "", /^https:\/\/checkout\.paystack\.test\/ESS-/);
    const sent = fake.state.initialize.at(-1)!;
    assert.equal(sent.headers.authorization, `Bearer ${KEY}`);
    assert.equal(sent.body.amount, 26500, "pesewas, straight from the server-side total");
    assert.equal(sent.body.currency, "GHS");
    assert.equal(sent.body.email, "233241234567@customers.esspordecants.web.app", "placeholder email comes from the phone number");
    assert.equal(sent.body.callback_url, `https://shop.test/track?number=${encodeURIComponent(placed.order.number)}`);
    const stock = await admin("GET", `/products/${productId}`);
    assert.equal(stock.data.variants[0].stockQuantity, 8, "stock is held while payment is pending");
  });

  test("tracking by order number shows status and nothing personal", async () => {
    const placed = await order();
    const res = await track(placed.order.number.toLowerCase().replace(/-/g, " "));
    assert.equal(res.status, 200, "typed from a screenshot: any case, spaces for hyphens");
    assert.equal(res.data.number, placed.order.number);
    assert.equal(res.data.stage.label, "Waiting for payment");
    assert.equal(res.data.canPay, true);
    const text = JSON.stringify(res.data);
    for (const secret of [customer.name, "24 123 4567", "Cantonments", "internalNotes", "actorName"]) assert.ok(!text.includes(secret), `leaked ${secret}`);
    assert.equal((await track("ESS-1000-AAAA")).status, 404);
    assert.equal((await track("nonsense")).status, 404);
  });

  test("a signed webhook marks the order paid once; wrong amounts and bad signatures do nothing", async () => {
    const placed = await order();
    const reference = placed.payment.reference!;
    const body = event(reference, placed.order.totalMinor);
    assert.equal((await webhook(body, "deadbeef")).status, 401);
    assert.equal((await track(placed.order.number)).data.status, "pending_payment");

    await webhook(event(reference, 100));
    const mismatch = await track(placed.order.number);
    assert.equal(mismatch.data.status, "pending_payment", "a short payment does not mark it paid");
    assert.equal(mismatch.data.paymentStatus, "amount_mismatch");

    assert.equal((await webhook(body)).status, 200);
    const paid = await track(placed.order.number);
    assert.equal(paid.data.status, "paid");
    assert.equal(paid.data.stage.label, "Payment received");
    assert.equal(paid.data.canPay, false);

    const before = paid.data.timeline.length;
    assert.equal((await webhook(body)).status, 200, "a repeat delivery is harmless");
    assert.equal((await track(placed.order.number)).data.timeline.length, before);
  });

  test("coming back from Paystack confirms payment even if the webhook never arrives", async () => {
    const placed = await order();
    fake.state.verify.set(placed.payment.reference!, { status: "success", amount: placed.order.totalMinor, currency: "GHS" });
    const res = await track(placed.order.number);
    assert.equal(res.data.status, "paid");
  });

  test("if Paystack is down the order is kept and can be paid from the tracking page", async () => {
    fake.state.failInitialize = true;
    const placed = await order();
    fake.state.failInitialize = false;
    assert.equal(placed.payment.status, "failed");
    assert.equal(placed.payment.authorizationUrl, null);
    const tracked = await track(placed.order.number);
    assert.equal(tracked.data.canPay, true);
    const retry = await call(app, "POST", `/api/v1/track/${placed.order.number}/pay`);
    assert.equal(retry.status, 200);
    assert.match(retry.data.payment.authorizationUrl, /^https:\/\/checkout\.paystack\.test\//);
    const paidAlready = await call(app, "POST", `/api/v1/track/${placed.order.number}/pay`);
    assert.equal(paidAlready.status, 200, "still unpaid, so another attempt is allowed");
  });

  test("unpaid orders expire and return their stock; a late payment is flagged for review", async () => {
    const before = (await admin("GET", `/products/${productId}`)).data.variants[0].stockQuantity;
    const placed = await order(2);
    assert.equal((await admin("GET", `/products/${productId}`)).data.variants[0].stockQuantity, before - 2);
    const doc = (await ctx.store.db.collection("orders").where("number", "==", placed.order.number).get()).docs[0]!;
    await doc.ref.update({ createdAt: new Date(Date.now() - 2 * 60 * 60_000).toISOString() });

    const expired = await track(placed.order.number);
    assert.equal(expired.data.status, "cancelled");
    assert.equal((await admin("GET", `/products/${productId}`)).data.variants[0].stockQuantity, before, "stock restored");

    await webhook(event(placed.payment.reference!, placed.order.totalMinor));
    const late = await track(placed.order.number);
    assert.equal(late.data.status, "cancelled");
    assert.match(late.data.stage.detail, /contact Esspor/i);
    const detail = await admin("GET", `/orders/${doc.id}`);
    assert.equal(detail.data.paymentStatus, "paid_needs_review");
  });

  test("the tracking route is rate limited", async () => {
    const limited = createApp({ store: ctx.store, config: { ...ctx.config, rateLimitTrackPerMin: 3 } });
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) statuses.push((await call(limited, "GET", "/api/v1/track/ESS-1-AAAA", { headers: { "x-forwarded-for": "203.0.113.9" } })).status);
    assert.deepEqual(statuses, [404, 404, 404, 429, 429]);
  });
});
