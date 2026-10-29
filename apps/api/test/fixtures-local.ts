// Local-only fixture for checking the storefront by eye: wipes the emulators and
// publishes one synthetic product plus home content through the real API.
// Run with: node --env-file=.env.emulators test/fixtures-local.ts
import assert from "node:assert/strict";
import { completeProduct, imageForm, login, setup } from "./helpers.ts";

const { app } = await setup({ publicBaseUrl: "http://localhost:4000" });
const { admin } = await login(app);

const product = await admin("POST", "/products", { body: { house: "Maison Verité", name: "Cèdre Lumière" } });
const id = product.data.id as string;
const front = await admin("POST", `/products/${id}/images`, {
  form: imageForm({ role: "decant-front", alt: "Esspor 5 ml decant, front view", isRealPhoto: "true" }),
});
await admin("PATCH", `/products/${id}/images/${front.data.id}`, { body: { approved: true } });
const source = await admin("POST", `/products/${id}/images`, {
  form: imageForm({ role: "source-bottle", alt: "Original full-size source bottle", isRealPhoto: "true" }),
});
await admin("PATCH", `/products/${id}/images/${source.data.id}`, { body: { approved: true } });
const five = await admin("POST", `/products/${id}/variants`, { body: { sku: "LOCAL-CDL-5", sizeMl: 5, priceMinor: 12000, stockQuantity: 2 } });
await admin("POST", `/products/${id}/variants`, { body: { sku: "LOCAL-CDL-10", sizeMl: 10, priceMinor: 21000, stockQuantity: 0 } });
await admin("PATCH", `/products/${id}`, { body: completeProduct });
const published = await admin("POST", `/products/${id}/publish`);
assert.equal(published.status, 200, JSON.stringify(published.data));

for (const entry of [
  { slug: "local-hero", placement: "home-hero", eyebrow: "Local check", title: "Published hero copy.", body: "First paragraph from the CMS.\n\nSecond paragraph.", ctaLabel: "See the scents", ctaHref: "/shop" },
  { slug: "local-story", placement: "home-story", eyebrow: "From the CMS", title: "Story title from the admin.", body: "Story body served by /api/v1/content." },
]) {
  const created = await admin("POST", "/content", { body: entry });
  await admin("POST", `/content/${created.data.id}/publish`);
}
console.log(`Published local fixture product ${published.data.slug}; 5 ml variant ${five.data.id}.`);
process.exit(0);
