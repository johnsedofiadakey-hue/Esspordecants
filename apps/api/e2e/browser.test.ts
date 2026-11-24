// End-to-end browser test of the storefront, run against the Firebase emulators.
//
// It stands up one origin that behaves like Firebase Hosting: static files from a real
// production build of the storefront (with the headers from firebase.json, including the
// Content-Security-Policy), and /api, /media, /product, /sitemap.xml and /robots.txt
// handled by the real API. Paystack is replaced by a small local stand-in. A real
// headless Chrome then walks the customer journey and fails on any console error, which
// includes content-security-policy violations.
//
// Run with: npm run e2e (builds the storefront first). Needs Chrome; set CHROME_PATH if
// it is not in a usual place.
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { after, before, describe, test } from "node:test";
import { getRequestListener } from "@hono/node-server";
import { createApp } from "../src/app.ts";
import { paystackAdapter } from "../src/services/payments.ts";
import { saveSiteSettings } from "../src/services/site.ts";
import { ADMIN_EMAIL, ADMIN_PASSWORD, createPublishedProduct, login, mediaForm, mp4, setup } from "../test/helpers.ts";

const PORT = 4173; // The storefront build is made with VITE_API_BASE_URL pointing here.
const ORIGIN = `http://127.0.0.1:${PORT}`;
const DIST = resolve(import.meta.dirname, ".dist");
const KEY = "sk_test_e2e_not_real";
const ADMIN_PORT = 5192;
const ADMIN = `http://127.0.0.1:${ADMIN_PORT}`;

const types: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".ttf": "font/ttf", ".json": "application/json" };

function chromePath(): string {
  const candidates = [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter((value): value is string => Boolean(value));
  const found = candidates.find((path) => existsSync(path));
  if (!found) throw new Error("No Chrome found. Set CHROME_PATH.");
  return found;
}

// Stand-in for api.paystack.co. POST /__pay/<reference> plays the customer paying.
function fakePaystack() {
  const paid = new Map<string, { amount: number; paid: boolean }>();
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const json = (code: number, body: unknown) => {
        res.writeHead(code, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };
      const url = new URL(req.url ?? "/", "http://x");
      if (req.method === "POST" && url.pathname === "/transaction/initialize") {
        const body = JSON.parse(raw);
        paid.set(body.reference, { amount: body.amount, paid: false });
        return json(200, { status: true, data: { authorization_url: `${fakeOrigin()}/pay/${body.reference}`, access_code: "x", reference: body.reference } });
      }
      const verify = url.pathname.match(/^\/transaction\/verify\/(.+)$/);
      if (verify) {
        const entry = paid.get(decodeURIComponent(verify[1]!));
        return json(200, { status: true, data: { status: entry?.paid ? "success" : "abandoned", amount: entry?.amount ?? 0, currency: "GHS" } });
      }
      const pay = url.pathname.match(/^\/__pay\/(.+)$/);
      if (pay) {
        const entry = paid.get(decodeURIComponent(pay[1]!));
        if (entry) entry.paid = true;
        return json(200, { ok: Boolean(entry) });
      }
      if (url.pathname.startsWith("/pay/")) {
        res.writeHead(200, { "content-type": "text/html" });
        return res.end("<h1>Pretend Paystack checkout</h1>");
      }
      json(404, { status: false });
    });
  });
  const fakeOrigin = () => `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return { server, origin: fakeOrigin };
}

// A minimal Chrome DevTools Protocol client over the WebSocket built into Node.
class Browser {
  private ws!: WebSocket;
  private id = 0;
  private pending = new Map<number, (message: any) => void>();
  consoleProblems: string[] = [];
  requests: string[] = [];
  private process!: ChildProcess;
  private profile = mkdtempSync(join(tmpdir(), "esspor-e2e-"));

  async start() {
    const port = 9400 + Math.floor(Math.random() * 400);
    const args = ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${this.profile}`, "--no-first-run", "--disable-gpu", "--disable-dev-shm-usage", "about:blank"];
    if (process.env.CI) args.push("--no-sandbox");
    this.process = spawn(chromePath(), args, { stdio: "ignore" });
    let wsUrl = "";
    for (let i = 0; i < 80 && !wsUrl; i++) {
      try {
        const list = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as { type: string; webSocketDebuggerUrl: string }[];
        wsUrl = list.find((target) => target.type === "page")?.webSocketDebuggerUrl ?? "";
      } catch {
        // Chrome is still starting.
      }
      if (!wsUrl) await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!wsUrl) throw new Error("Chrome did not start.");
    this.ws = new WebSocket(wsUrl);
    await new Promise((resolve) => (this.ws.onopen = resolve));
    this.ws.onmessage = (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id && this.pending.has(message.id)) {
        this.pending.get(message.id)!(message);
        this.pending.delete(message.id);
      } else if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
        this.consoleProblems.push(message.params.args.map((a: any) => a.value ?? a.description).join(" ").slice(0, 300));
      } else if (message.method === "Runtime.exceptionThrown") {
        this.consoleProblems.push(`EXCEPTION ${message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text}`.slice(0, 300));
      } else if (message.method === "Log.entryAdded" && ["error"].includes(message.params.entry.level)) {
        const line = `${message.params.entry.text} ${message.params.entry.url ?? ""}`.slice(0, 300);
        // Chrome asks for /favicon.ico on its own, and a wrong order number is meant to 404.
        if (!/favicon\.ico|\/api\/v1\/track\/ESS-1-ZZZZ/.test(line)) this.consoleProblems.push(line);
      } else if (message.method === "Network.requestWillBeSent") {
        this.requests.push(message.params.request.url);
      }
    };
    for (const domain of ["Page", "Runtime", "Log", "Network"]) await this.send(`${domain}.enable`);
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      this.pending.set(id, (message) => (message.error ? reject(new Error(`${method}: ${message.error.message}`)) : resolve(message.result)));
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval<T = unknown>(expression: string): Promise<T> {
    const result = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value as T;
  }

  async waitFor(expression: string, what: string, timeoutMs = 10_000) {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      if (await this.eval<boolean>(`Boolean(${expression})`).catch(() => false)) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Timed out waiting for ${what}`);
  }

  async go(path: string, ready = "document.querySelector('h1')") {
    await this.send("Page.navigate", { url: path.startsWith("http") ? path : ORIGIN + path });
    await new Promise((resolve) => setTimeout(resolve, 150));
    await this.waitFor(`document.readyState !== 'loading' && ${ready}`, `${path} to render`);
  }

  viewport(width: number, mobile = false) {
    return this.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile });
  }

  // Types into a React input the way a person would, so the app sees the change.
  type(selector: string, value: string) {
    return this.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event("input", { bubbles: true }));
    })()`);
  }

  // Clicks the first element whose text matches, the way a finger would.
  clickText(selector: string, text: string) {
    return this.eval<boolean>(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => e.textContent.trim().toLowerCase().startsWith(${JSON.stringify(text.toLowerCase())})); if (!el) return false; el.click(); return true; })()`);
  }

  text(selector = "body") {
    return this.eval<string>(`document.querySelector(${JSON.stringify(selector)})?.innerText.replace(/\\s+/g, " ") ?? ""`);
  }

  async stop() {
    this.ws?.close();
    if (this.process && this.process.exitCode === null) {
      const exited = new Promise((resolve) => this.process.once("exit", resolve));
      this.process.kill();
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5000))]);
    }
    // Tidying a temp folder must never fail the run.
    try {
      rmSync(this.profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      // Left behind in the system temp folder; harmless.
    }
  }
}

describe("Storefront and admin in a real browser", () => {
  const paystack = fakePaystack();
  let site: Server;
  let browser: Browser;
  let adminBrowser: Browser;
  let vite: ChildProcess | undefined;
  let adminApi: Awaited<ReturnType<typeof login>>["admin"];
  let slug = "";
  let variantId = "";

  before(async () => {
    assert.ok(existsSync(join(DIST, "index.html")), "Build the storefront first: npm run e2e does this.");
    await new Promise<void>((resolve) => paystack.server.listen(0, "127.0.0.1", resolve));
    const ctx = await setup({
      checkoutEnabled: true,
      publicBaseUrl: ORIGIN,
      siteUrl: ORIGIN,
      storefrontOrigins: [ORIGIN],
      paystackSecretKey: KEY,
      paystackBaseUrl: paystack.origin(),
    });
    const payments = paystackAdapter(ctx.config);
    const app = createApp({
      store: ctx.store,
      config: ctx.config,
      payments,
      // The real shell, fetched over HTTP from this same origin, so its headers pass through.
      fetchShell: async () => {
        const response = await fetch(`${ORIGIN}/index.html`);
        const headers: Record<string, string> = {};
        for (const name of ["content-security-policy", "permissions-policy"]) {
          const value = response.headers.get(name);
          if (value) headers[name] = value;
        }
        return { html: await response.text(), headers };
      },
    });
    const admin = (await login(app)).admin;
    const made = await createPublishedProduct(admin, 12, "Cèdre Lumière");
    variantId = made.variantId;
    slug = (await admin("GET", `/products/${made.productId}`)).data.slug;
    // A video on the product, to prove the page does not download it until played.
    const clip = await admin("POST", `/products/${made.productId}/images`, { form: mediaForm({ role: "decant-side", alt: "Actual decant being sprayed", isRealPhoto: "true" }, mp4(2048), "spray.mp4", "video/mp4") });
    await admin("PATCH", `/products/${made.productId}/images/${clip.data.id}`, { body: { approved: true } });
    // Two more fragrances, so filtering and sorting have something to work on.
    const extra = async (name: string, family: string, audience: string, accords: string[], priceMinor: number) => {
      const made = await createPublishedProduct(admin, 6, name);
      await admin("PATCH", `/products/${made.productId}`, { body: { name, house: "Atelier Noor", family, audience, accords, longevity: 4, projection: 3, seasons: ["autumn"], occasions: ["evening"], featured: name === "Amber Night" } });
      await admin("PATCH", `/products/${made.productId}/variants/${made.variantId}`, { body: { priceMinor } });
    };
    await extra("Amber Night", "Oriental", "men", ["amber", "oud", "spicy"], 9500);
    await extra("Citrus Morn", "Citrus", "women", ["citrus", "fresh"], 5000);
    adminApi = admin;
    await admin("POST", "/delivery-options", { body: { code: "pickup", label: "Esspor pickup point", priceMinor: 0, method: "pickup", active: true, sortOrder: 0 } });
    await admin("POST", "/delivery-options", { body: { code: "courier", label: "Courier delivery", priceMinor: 2500, method: "delivery", active: true, sortOrder: 1 } });
    await saveSiteSettings(ctx.store, {
      businessName: "Esspor Decants",
      announcement: "Order before 8PM for next-day delivery | Mon–Fri",
      whatsapp: "024 555 0199",
      phone: "",
      email: "",
      instagram: "esspor.gh",
      pickupNote: "Osu, Accra. Weekdays 10 to 6.",
    });

    const api = getRequestListener(app.fetch);
    const headersFor = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../firebase.json"), "utf8")).hosting.find((entry: { target: string }) => entry.target === "storefront").headers.find((entry: { source: string }) => entry.source === "**").headers as { key: string; value: string }[];
    site = createServer((req, res) => {
      const path = new URL(req.url ?? "/", ORIGIN).pathname;
      if (/^\/(api|media|product)\//.test(path) || path === "/sitemap.xml") return api(req, res);
      let file = join(DIST, path);
      if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, "index.html");
      res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream", ...Object.fromEntries(headersFor.map((header) => [header.key, header.value])) });
      res.end(readFileSync(file));
    });
    await new Promise<void>((resolve) => site.listen(PORT, "127.0.0.1", resolve));
    browser = new Browser();
    await browser.start();

    // The admin runs in development mode, which signs in through the Auth emulator and
    // sends /api calls to the same API as above.
    vite = spawn(process.execPath, [resolve(import.meta.dirname, "../../admin/node_modules/vite/bin/vite.js"), "--port", String(ADMIN_PORT), "--host", "127.0.0.1"], {
      cwd: resolve(import.meta.dirname, "../../admin"),
      env: { ...process.env, ADMIN_API_PROXY_TARGET: ORIGIN },
      stdio: "ignore",
    });
    for (let i = 0; i < 120; i++) {
      if (await fetch(`${ADMIN}/`).then((r) => r.ok, () => false)) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    adminBrowser = new Browser();
    await adminBrowser.start();
  });

  after(async () => {
    await adminBrowser?.stop();
    vite?.kill();
    await browser?.stop();
    site?.close();
    paystack.server.close();
  });

  test("the home page shows the editable banner and has no console or security-policy errors", async () => {
    await browser.viewport(1280);
    await browser.go("/");
    assert.equal(
      await browser.eval(`document.querySelector(".announce-bar").getAttribute("aria-label")`),
      "Order before 8PM for next-day delivery | Mon–Fri",
    );
    assert.equal(await browser.eval(`document.querySelector(".announce-bar__track").getAttribute("aria-hidden")`), "true");
    assert.equal(await browser.eval(`getComputedStyle(document.querySelector(".announce-bar__track")).animationName`), "announce-loop");
    assert.match(await browser.eval<string>("document.title"), /Esspor Decants/);
    assert.equal(await browser.eval("!!document.querySelector('a.skip-link')"), true);
    assert.deepEqual(browser.consoleProblems, []);
  });

  test("a product link carries its own title and image for sharing, and the page still works", async () => {
    const page = await fetch(`${ORIGIN}/product/${slug}`);
    const html = await page.text();
    assert.equal(page.status, 200);
    assert.match(html, /<title>Cèdre Lumière by Maison Verité/);
    assert.match(html, /property="og:image" content="http:\/\/127\.0\.0\.1:4173\/media\//);
    assert.ok(page.headers.get("content-security-policy")?.includes("frame-ancestors 'none'"), "security headers reach preview pages");
    assert.equal((await fetch(`${ORIGIN}/product/not-here`)).status, 404);

    await browser.go(`/product/${slug}`, "document.querySelector('.thumbnail-row button')");
    assert.match(await browser.eval<string>("document.title"), /Cèdre Lumière by Maison Verité/);
    assert.equal(await browser.eval("document.querySelectorAll('.thumbnail-row button').length"), 2, "a photo and a video");
    assert.equal(await browser.eval("document.querySelectorAll('.thumbnail-row .play-badge').length"), 1);
    assert.ok(!browser.requests.some((url) => /\.mp4/.test(url)), "the video is not downloaded until someone plays it");
    assert.deepEqual(browser.consoleProblems, []);
  });

  test("a customer can order for pickup, pay on Paystack, come back and see it paid", async () => {
    await browser.go(`/product/${slug}`, "document.querySelector('.buy-row .button')");
    await browser.eval("document.querySelector('.buy-row .button').click()");
    await browser.waitFor("document.querySelector('.added-message')", "the added-to-bag message");
    await browser.go("/bag", "document.querySelector('.checkout-form')");
    await browser.waitFor("document.querySelectorAll('.checkout-form .choice').length === 2", "the two ways to receive the order");
    assert.match(await browser.text(".checkout-form"), /Pick up · Esspor pickup point/);
    assert.equal(await browser.eval("document.querySelectorAll('.checkout-form .field').length"), 2, "pickup asks for only a name and a phone number");

    await browser.eval("document.querySelectorAll('.checkout-form .choice input')[1].click()");
    await browser.waitFor("document.querySelector('textarea[name=address]')", "the address box for delivery");
    await browser.waitFor("/25\\.00/.test(document.querySelector('.totals').innerText)", "the delivery fee in the total");
    await browser.eval("document.querySelectorAll('.checkout-form .choice input')[0].click()");
    await browser.waitFor("!document.querySelector('textarea[name=address]')", "the address box to go away for pickup");

    assert.equal(await browser.eval("document.querySelector('.checkout-form').checkValidity()"), false, "empty details are refused");
    await browser.type("input[name=name]", "Efua Asante");
    await browser.type("input[name=phone]", "024 555 0188");
    await browser.waitFor("document.querySelector('.checkout-form').checkValidity() && !document.querySelector('.checkout-form .button').disabled", "the order button to unlock");
    await browser.eval("document.querySelector('.checkout-form .button').click()");
    await browser.waitFor(`location.href.startsWith(${JSON.stringify(paystack.origin())})`, "the redirect to Paystack");
    const reference = decodeURIComponent((await browser.eval<string>("location.pathname")).replace("/pay/", ""));
    const number = reference.replace(/-[a-z0-9]{6}$/, "");
    assert.match(number, /^ESS-\d+-[A-Z0-9]{4}$/);

    await fetch(`${paystack.origin()}/__pay/${encodeURIComponent(reference)}`, { method: "POST" });
    await browser.go(`/track?number=${encodeURIComponent(number)}`, "document.querySelector('.track-card')");
    await browser.waitFor("/Payment received/.test(document.querySelector('.track-card').innerText)", "the paid status");
    assert.equal(await browser.eval("JSON.parse(localStorage.getItem('esspor-bag-v1') || '[]').length"), 0, "the bag is emptied");

    // Typing the number in by hand works, in any case.
    await browser.go("/track");
    await browser.type("#track-number", number.toLowerCase());
    await browser.eval("document.querySelector('.track-form').requestSubmit()");
    await browser.waitFor("document.querySelector('.track-card')", "the tracking result");
    assert.match(await browser.text(".track-card"), /Payment received/);
    assert.match(await browser.text(".track-card"), /Message us on WhatsApp/);
    assert.deepEqual(browser.consoleProblems, []);
  });

  test("an unknown order number gives a clear message", async () => {
    await browser.go("/track");
    await browser.type("#track-number", "ESS-1-ZZZZ");
    await browser.eval("document.querySelector('.track-form').requestSubmit()");
    await browser.waitFor("document.querySelector('.track-problem')", "the not-found message");
    assert.match(await browser.text(".track-problem"), /couldn't find that order/);
  });

  test("information pages, contact details and 404s", async () => {
    for (const [path, heading] of [["/privacy", "Privacy."], ["/terms", "Terms of sale."], ["/delivery-returns", "Delivery & returns."], ["/contact", "Contact."]] as const) {
      await browser.go(path);
      assert.equal(await browser.text("h1"), heading);
    }
    assert.match(await browser.eval<string>("document.querySelector('.info-page').innerHTML"), /wa\.me\/233245550199/);
    assert.match(await browser.text(".info-page"), /Osu, Accra\. Weekdays 10 to 6\./);
    assert.match(await browser.eval<string>("document.querySelector('.site-footer').innerHTML"), /instagram\.com\/esspor\.gh/);
    assert.match(await browser.eval<string>("document.querySelector('.site-footer .staff-link').href"), /^https:\/\/[^/]*admin[^/]*\//, "the footer has a quiet link to the admin site");
    assert.ok(Number(await browser.eval("getComputedStyle(document.querySelector('.site-footer .staff-link')).opacity")) < 1, "and it is understated until hovered");
    await browser.go("/nonsense");
    assert.equal(await browser.text("h1"), "Page not found");
    assert.equal(await browser.eval("document.querySelector('meta[name=robots]')?.content"), "noindex");
    await browser.go("/preview/product");
    assert.equal(await browser.text("h1"), "Page not found", "the layout preview is not served outside development");
    assert.deepEqual(browser.consoleProblems, []);
  });

  test("nothing overflows sideways on a phone", async () => {
    await browser.viewport(390, true);
    for (const path of ["/", "/shop", `/product/${slug}`, "/bag", "/track", "/privacy", "/contact"]) {
      await browser.go(path);
      await new Promise((resolve) => setTimeout(resolve, 300));
      // On failure, name the elements that stick out so the cause is obvious.
      const wide = await browser.eval<string[]>(`(() => { const w = document.documentElement.clientWidth; return [...document.querySelectorAll("body *")].filter((e) => { const r = e.getBoundingClientRect(); return r.right > w + 1 && !e.closest(".announce-bar, .hero-image"); }).slice(0, 6).map((e) => (e.className && e.className.baseVal === undefined ? e.className : e.tagName) + " " + Math.round(e.getBoundingClientRect().right)); })()`);
      assert.equal(await browser.eval("document.documentElement.scrollWidth <= document.documentElement.clientWidth"), true, `${path} is wider than the screen: ${wide.join("; ")}`);
    }
    await browser.viewport(1280);
  });

  test("robots.txt and the sitemap point search engines at the right places", async () => {
    // robots.txt is a plain static file: Google's function frontend swallows that path.
    const robots = await (await fetch(`${ORIGIN}/robots.txt`)).text();
    assert.ok(robots.includes("Disallow: /track") && /Sitemap: https?:\/\/\S+\/sitemap\.xml/.test(robots));
    const sitemap = await (await fetch(`${ORIGIN}/sitemap.xml`)).text();
    assert.ok(sitemap.includes(`${ORIGIN}/product/${slug}`) && sitemap.includes(`${ORIGIN}/privacy`));
    assert.ok(variantId.length > 0);
  });

  // ---------- The shop ----------

  test("the home page sells like a shop: trust bar, new arrivals, ways to shop, questions and a chat link", async () => {
    await browser.viewport(1280);
    await browser.go("/", "document.querySelector('.shelf .pcard')");
    assert.equal(await browser.eval("document.querySelectorAll('.trust-bar > div').length"), 4);
    assert.ok((await browser.eval<number>("document.querySelectorAll('.shelf .pcard').length")) >= 3, "new arrivals show real products");
    assert.match(await browser.text(".ways"), /bottle size/i);
    assert.equal(await browser.eval("document.querySelectorAll('.faq details').length"), 6);
    assert.match(await browser.eval<string>("document.querySelector('.chat-band a.button').href"), /wa\.me\/233245550199/);
    assert.deepEqual(browser.consoleProblems, []);
  });

  test("the shop filters, sorts and clears, and the choice lives in the web address", async () => {
    await browser.go("/shop", "document.querySelectorAll('.pcard').length >= 3");
    assert.equal(await browser.eval("document.querySelectorAll('.shop-filters .fgroup').length >= 4"), true, "family, who it is for, flavours and size are offered");
    assert.equal(await browser.clickText(".fopt", "Citrus"), true);
    await browser.waitFor("location.search.includes('family=Citrus') && document.querySelectorAll('.pcard').length === 1", "the Citrus filter");
    assert.match(await browser.text(".shop-count"), /1 fragrance/);
    assert.match(await browser.text(".active-filters"), /Citrus/);
    await browser.eval("document.querySelector('.active-filters .text-link').click()");
    await browser.waitFor("document.querySelectorAll('.pcard').length === 3 && !location.search", "clearing the filter");

    await browser.eval(`(() => { const select = document.querySelector('.shop-bar__sort select'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, 'price-asc'); select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await browser.waitFor("location.search.includes('sort=price-asc')", "the sort");
    await browser.waitFor("document.querySelector('.pcard h3')?.textContent === 'Citrus Morn'", "cheapest first");
    assert.equal(await browser.eval("[...document.querySelectorAll('.pcard h3')].map((e) => e.textContent).join(',')"), "Citrus Morn,Amber Night,Cèdre Lumière");

    await browser.go("/shop?audience=men", "document.querySelectorAll('.pcard').length >= 1");
    await browser.waitFor("document.querySelectorAll('.pcard').length === 1", "the men's filter");
    assert.match(await browser.text(".pcard"), /Amber Night/);
    await browser.go("/shop?query=nothing-like-this", "document.querySelector('.status-panel')");
    assert.match(await browser.text(".status-panel"), /No fragrance matches/);
    assert.deepEqual(browser.consoleProblems, []);
  });

  test("a product page shows sizes with prices, flavours, the scent profile and other fragrances to try", async () => {
    await browser.go(`/product/${slug}`, "document.querySelector('.size-card')");
    assert.match(await browser.text(".size-card"), /5 ml.*GH₵120\.00/);
    assert.ok((await browser.eval<number>("document.querySelectorAll('.accord-list a').length")) >= 0);
    await browser.go("/product/maison-verite-amber-night", "document.querySelector('.accordion')");
    assert.match(await browser.text(".accord-list"), /amber.*oud.*spicy/i);
    assert.match(await browser.text(".pinfo__badges"), /^new for him eau de parfum$/i);
    assert.match(await browser.text(".accordion"), /about the scent/i);
    assert.match(await browser.text(".pyramid"), /top.*heart.*base/i);
    assert.match(await browser.text(".wears"), /lasts.*long.*projects/i);
    await browser.waitFor("document.querySelectorAll('.shelf .pcard').length >= 2", "other fragrances to try");
    assert.deepEqual(browser.consoleProblems, []);
  });

  test("on a phone, filters open as a sheet and the buy button follows you down the page", async () => {
    await browser.viewport(390, true);
    await browser.go("/shop", "document.querySelectorAll('.pcard').length >= 3");
    assert.equal(await browser.eval("getComputedStyle(document.querySelector('.shop-filters')).position"), "fixed");
    await browser.eval("document.querySelector('.shop-bar__filters').click()");
    await browser.waitFor("document.querySelector('.shop-filters').classList.contains('open')", "the filter sheet");
    await browser.clickText(".fopt", "For her");
    await browser.waitFor("document.querySelectorAll('.pcard').length === 1", "the filter to apply");
    await browser.eval("document.querySelector('.shop-filters__head button').click()");
    await browser.waitFor("!document.querySelector('.shop-filters').classList.contains('open')", "the sheet to close");

    await browser.go(`/product/${slug}`, "document.querySelector('.product-buy')");
    assert.equal(await browser.eval("document.querySelector('.sticky-buy').classList.contains('show')"), false, "not while the main button is in view");
    await browser.eval("document.querySelector('.accordion').scrollIntoView()");
    await browser.waitFor("document.querySelector('.sticky-buy').classList.contains('show')", "the sticky buy bar");
    assert.match(await browser.text(".sticky-buy"), /GH₵120\.00.*add to bag/i);
    await browser.viewport(1280);
  });

  // ---------- The admin ----------

  const adminPages = ["/", "/products", "/orders", "/content", "/settings", "/help", "/products/new"];

  test("the admin signs in, and on a phone it is an app: bottom bar, card lists, nothing off the screen", async () => {
    await adminBrowser.viewport(390, true);
    await adminBrowser.go(`${ADMIN}/`, "document.querySelector('input[type=email]')");
    await adminBrowser.type("input[type=email]", ADMIN_EMAIL);
    await adminBrowser.type("input[type=password]", ADMIN_PASSWORD);
    await adminBrowser.eval("document.querySelector('form').requestSubmit()");
    await adminBrowser.waitFor("document.querySelector('.bottom-nav')", "the signed-in admin", 20_000);
    assert.notEqual(await adminBrowser.eval("getComputedStyle(document.querySelector('.bottom-nav')).display"), "none");
    assert.equal(await adminBrowser.eval("getComputedStyle(document.querySelector('.sidebar')).display"), "none");
    assert.deepEqual(await adminBrowser.eval("[...document.querySelectorAll('.bottom-nav > *')].map((e) => e.innerText.trim().split('\\n')[0])"), ["Overview", "Products", "Orders", "Content", "More"]);

    for (const path of adminPages) {
      await adminBrowser.go(`${ADMIN}${path}`, "document.querySelector('main h1, main .empty')");
      await new Promise((resolve) => setTimeout(resolve, 250));
      const wide = await adminBrowser.eval<string[]>(`(() => { const w = document.documentElement.clientWidth; return [...document.querySelectorAll("main *")].filter((e) => e.getBoundingClientRect().right > w + 1).slice(0, 5).map((e) => (e.className || e.tagName) + " " + Math.round(e.getBoundingClientRect().right)); })()`);
      assert.equal(await adminBrowser.eval("document.documentElement.scrollWidth <= document.documentElement.clientWidth"), true, `admin ${path} is wider than the screen: ${wide.join("; ")}`);
    }
    await adminBrowser.go(`${ADMIN}/products`, "document.querySelector('.rows .row')");
    assert.ok((await adminBrowser.eval<number>("document.querySelectorAll('.rows .row').length")) >= 3, "products are listed as rows");
    await adminBrowser.go(`${ADMIN}/settings`, "document.querySelector('.card table.table')");
    assert.equal(await adminBrowser.eval("getComputedStyle(document.querySelector('.card table.table thead')).display"), "none", "tables become cards on a phone");
  });

  test("a fragrance is added from one guided page: tap the choices, set sizes, save a draft with every size", async () => {
    await adminBrowser.go(`${ADMIN}/products/new`, "document.querySelector('.wizard')");
    await adminBrowser.eval(`(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const setVal = (el, v) => { const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); };
      const input = (label) => [...document.querySelectorAll(".field")].find((f) => f.innerText.trim().startsWith(label)).querySelector("input, textarea");
      const chip = (group, text) => [...document.querySelectorAll('[aria-label="' + group + '"] .chip')].find((c) => c.textContent.trim().toLowerCase() === text.toLowerCase());
      setVal(input("Fragrance house"), "Lattafa"); setVal(input("Fragrance name"), "Khamrah");
      // A pause between taps, as with a finger: the page redraws between one tap and the next.
      const tap = async (group, text) => { chip(group, text).click(); await sleep(40); };
      await tap("Strength", "Eau de Parfum"); await tap("Who it is for", "For anyone");
      await tap("Scent family", "Gourmand"); await tap("Flavours", "vanilla"); await tap("Flavours", "spicy");
      const note = document.querySelector('input[aria-label="Top notes"]');
      for (const w of ["cinnamon", "nutmeg"]) { setVal(note, w); note.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); await sleep(50); }
      await tap("Bottle sizes", "5 ml"); await tap("Bottle sizes", "10 ml");
      const rows = [...document.querySelectorAll(".size-row")];
      setVal(rows[0].querySelectorAll("input")[0], "85"); setVal(rows[0].querySelectorAll("input")[1], "10");
      setVal(rows[1].querySelectorAll("input")[0], "150"); setVal(rows[1].querySelectorAll("input")[1], "6");
      setVal(input("One-line summary"), "Warm spice and dates over creamy vanilla.");
      setVal(input("Full description"), "A rich, sweet gourmand with cinnamon, dates and vanilla.");
      document.querySelectorAll(".dots")[0].querySelectorAll("button")[3].click(); await sleep(40);
      await tap("Best seasons", "autumn");
    })()`);
    assert.deepEqual(await adminBrowser.eval("[...document.querySelectorAll('.size-row input.mono')].map((i) => i.value)"), ["LAT-KHA-5", "LAT-KHA-10"], "codes are made for you");
    assert.match(await adminBrowser.text(".wizard-bar"), /4 of 5 sections filled/, "everything but the receives details is done");
    await adminBrowser.eval("document.querySelector('.wizard-bar button[type=submit]').click()");
    await adminBrowser.waitFor("location.search === '?new=1' && document.querySelector('.checklist-toggle')", "the new draft's page", 20_000);
    assert.match(await adminBrowser.text(".notice"), /Draft saved/);

    const id = (await adminBrowser.eval<string>("location.pathname")).split("/").pop()!;
    const saved = (await adminApi("GET", `/products/${id}`)).data;
    assert.equal(saved.status, "draft", "nothing is public yet");
    assert.equal(saved.audience, "unisex");
    assert.deepEqual(saved.accords, ["vanilla", "spicy"]);
    assert.deepEqual(saved.notes.top, ["cinnamon", "nutmeg"]);
    assert.deepEqual(saved.variants.map((v: { sizeMl: number; priceMinor: number; stockQuantity: number }) => [v.sizeMl, v.priceMinor, v.stockQuantity]), [[5, 8500, 10], [10, 15000, 6]]);
    assert.equal(saved.publishable, false, "it still needs photos before it can go on sale");
    assert.equal(await adminBrowser.eval("localStorage.getItem('esspor-new-product-draft')"), null, "the saved draft is cleared from the phone");
  });

  test("the Help guide opens inside the admin and covers the main jobs", async () => {
    await adminBrowser.go(`${ADMIN}/help`, "document.querySelector('.guide-toc')");
    const topics = await adminBrowser.eval<string[]>("[...document.querySelectorAll('.guide-toc button')].map((b) => b.textContent)");
    for (const wanted of ["Add a fragrance", "Add photos and videos", "Handle orders", "Delivery and pickup"]) assert.ok(topics.some((t) => t.includes(wanted)), `Help covers: ${wanted}`);
    assert.equal(await adminBrowser.clickText(".guide-toc button", "6."), true);
    await adminBrowser.waitFor("document.querySelector('#handle-orders').open", "the orders section to open");
    assert.match(await adminBrowser.text("#handle-orders"), /Mark processing/);
    assert.match(await adminBrowser.text("#handle-orders"), /does not send money back/);
    assert.equal(await adminBrowser.eval("document.documentElement.scrollWidth <= document.documentElement.clientWidth"), true);
    assert.deepEqual(adminBrowser.consoleProblems.filter((line) => !/favicon|Failed to load resource.*(401|404)/.test(line)), []);
  });
});
