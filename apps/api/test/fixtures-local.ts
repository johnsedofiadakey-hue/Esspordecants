// Local-only fixture for checking the storefront by eye: wipes the emulators and
// publishes one synthetic product plus home content through the real API.
// Run with: node --env-file=.env.emulators test/fixtures-local.ts
import assert from "node:assert/strict";
import { saveSiteSettings } from "../src/services/site.ts";
import { bottlePng } from "./demo-images.ts";
import { completeProduct, imageForm, login, mediaForm, mp4, setup } from "./helpers.ts";

const { app, store } = await setup({ publicBaseUrl: "http://localhost:4000" });
const { admin } = await login(app);

const product = await admin("POST", "/products", { body: { house: "Maison Verité", name: "Cèdre Lumière" } });
const id = product.data.id as string;
const front = await admin("POST", `/products/${id}/images`, {
  form: imageForm({ role: "decant-front", alt: "Esspor 5 ml decant, front view", isRealPhoto: "true" }, bottlePng(95, "front"), "front.png"),
});
await admin("PATCH", `/products/${id}/images/${front.data.id}`, { body: { approved: true } });
const source = await admin("POST", `/products/${id}/images`, {
  form: imageForm({ role: "source-bottle", alt: "Original full-size source bottle", isRealPhoto: "true" }),
});
await admin("PATCH", `/products/${id}/images/${source.data.id}`, { body: { approved: true } });
// A second photo and a (non-playable) video, to see the gallery with mixed media.
const side = await admin("POST", `/products/${id}/images`, {
  form: imageForm({ role: "decant-side", alt: "Esspor 5 ml decant, side view", isRealPhoto: "true" }),
});
await admin("PATCH", `/products/${id}/images/${side.data.id}`, { body: { approved: true } });
const clip = await admin("POST", `/products/${id}/images`, {
  form: mediaForm({ role: "decant-side", alt: "Esspor decant being sprayed", isRealPhoto: "true" }, mp4(4096), "spray.mp4", "video/mp4"),
});
await admin("PATCH", `/products/${id}/images/${clip.data.id}`, { body: { approved: true } });
const five = await admin("POST", `/products/${id}/variants`, { body: { sku: "LOCAL-CDL-5", sizeMl: 5, priceMinor: 12000, stockQuantity: 2 } });
await admin("POST", `/products/${id}/variants`, { body: { sku: "LOCAL-CDL-10", sizeMl: 10, priceMinor: 21000, stockQuantity: 0 } });
await admin("PATCH", `/products/${id}`, { body: completeProduct });
const published = await admin("POST", `/products/${id}/publish`);
assert.equal(published.status, 200, JSON.stringify(published.data));

// One pickup point and one courier, both active, so checkout shows the two choices.
await admin("POST", "/delivery-options", { body: { code: "local-pickup", label: "Esspor pickup point", description: "Collect in person. We'll call to arrange a time.", priceMinor: 0, method: "pickup", active: true, sortOrder: 0 } });
await admin("POST", "/delivery-options", { body: { code: "local-courier", label: "Courier delivery", description: "Next-day delivery, Mon–Fri.", priceMinor: 2500, method: "delivery", active: true, sortOrder: 1 } });

// A fuller, entirely fictional catalogue so the shop can be judged the way it will look.
const demo: {
  house: string; name: string; hue: number; concentration: string; family: string; audience: "women" | "men" | "unisex"; accords: string[];
  top: string[]; heart: string[]; base: string[]; short: string; long: string; longevity: number; projection: number; seasons: string[]; occasions: string[];
  featured?: boolean; sizes: [number, number, number][];
}[] = [
  { house: "Atelier Noor", name: "Amber Nuit", hue: 28, concentration: "Eau de Parfum", family: "Oriental", audience: "men", accords: ["amber", "oud", "spicy", "sweet"], top: ["cardamom", "saffron"], heart: ["rose", "incense"], base: ["amber", "oud", "vanilla"], short: "Smoky amber and oud wrapped in warm spice.", long: "A deep, evening fragrance. Saffron and cardamom open into incense and rose, settling on a long amber and oud base.", longevity: 5, projection: 4, seasons: ["autumn", "winter"], occasions: ["evening", "special"], featured: true, sizes: [[5, 9500, 12], [10, 16500, 8], [30, 42000, 3]] },
  { house: "Atelier Noor", name: "Rose Safran", hue: 340, concentration: "Eau de Parfum", family: "Floral", audience: "women", accords: ["rose", "saffron", "sweet", "powdery"], top: ["pink pepper", "bergamot"], heart: ["rose", "saffron"], base: ["musk", "sandalwood"], short: "Velvety rose with a thread of saffron.", long: "Romantic and polished. Rose petals and saffron over a soft, powdery musk.", longevity: 4, projection: 3, seasons: ["spring", "autumn"], occasions: ["date-night", "special"], featured: true, sizes: [[5, 8500, 10], [10, 15000, 6]] },
  { house: "Casa Sol", name: "Citron Matin", hue: 62, concentration: "Eau de Toilette", family: "Citrus", audience: "unisex", accords: ["citrus", "fresh", "green"], top: ["lemon", "bergamot", "mandarin"], heart: ["mint", "green tea"], base: ["cedar", "musk"], short: "A bright, sparkling citrus for hot days.", long: "Zesty lemon and mandarin over cool mint and a clean cedar finish. Easy to wear anywhere.", longevity: 2, projection: 3, seasons: ["spring", "summer"], occasions: ["daily", "work", "casual"], sizes: [[3, 4000, 20], [5, 5500, 15], [10, 9500, 9]] },
  { house: "Casa Sol", name: "Brise Marine", hue: 200, concentration: "Eau de Toilette", family: "Aquatic", audience: "men", accords: ["aquatic", "fresh", "woody"], top: ["sea notes", "grapefruit"], heart: ["lavender", "geranium"], base: ["vetiver", "ambergris"], short: "Sea spray, lavender and clean woods.", long: "Fresh and masculine, like a morning at the coast. Salty air, lavender and vetiver.", longevity: 3, projection: 3, seasons: ["summer", "spring"], occasions: ["daily", "casual", "work"], sizes: [[5, 6000, 14], [10, 10500, 7]] },
  { house: "Oud & Co", name: "Royal Oud", hue: 18, concentration: "Parfum / Extrait", family: "Oud", audience: "unisex", accords: ["oud", "woody", "leather", "smoky"], top: ["saffron", "pink pepper"], heart: ["oud", "leather"], base: ["sandalwood", "amber", "patchouli"], short: "Pure, resinous oud with leather and smoke.", long: "Rich, regal and long-lasting. A true oud composition for those who love depth.", longevity: 5, projection: 5, seasons: ["autumn", "winter"], occasions: ["evening", "special"], featured: true, sizes: [[2, 7000, 6], [5, 15500, 4], [10, 28000, 2]] },
  { house: "Oud & Co", name: "Vanilla Tonka", hue: 38, concentration: "Eau de Parfum", family: "Gourmand", audience: "women", accords: ["vanilla", "caramel", "sweet", "coconut"], top: ["pear", "cinnamon"], heart: ["coconut", "praline"], base: ["vanilla", "tonka bean", "musk"], short: "Creamy vanilla, caramel and tonka bean.", long: "A warm, edible hug. Sweet and comforting, perfect for cooler evenings.", longevity: 4, projection: 3, seasons: ["autumn", "winter"], occasions: ["date-night", "evening", "casual"], sizes: [[5, 7500, 0], [10, 13500, 0]] },
  { house: "Nuit d'Ambre", name: "Velours Noir", hue: 270, concentration: "Eau de Parfum", family: "Leather", audience: "men", accords: ["leather", "tobacco", "spicy", "smoky"], top: ["black pepper", "bergamot"], heart: ["leather", "tobacco"], base: ["patchouli", "labdanum", "vanilla"], short: "Dark leather and tobacco with a sweet edge.", long: "Mysterious and confident. Black pepper, supple leather and sweet tobacco.", longevity: 4, projection: 4, seasons: ["autumn", "winter"], occasions: ["evening", "date-night"], sizes: [[5, 9000, 2], [10, 16000, 5]] },
  { house: "Nuit d'Ambre", name: "Fleur Blanche", hue: 320, concentration: "Eau de Parfum", family: "Floral", audience: "women", accords: ["floral", "fruity", "fresh", "powdery"], top: ["peach", "blackcurrant"], heart: ["jasmine", "tuberose", "orange blossom"], base: ["musk", "cedar"], short: "White flowers and ripe peach, light and radiant.", long: "A luminous bouquet of jasmine and orange blossom with a juicy peach opening.", longevity: 3, projection: 3, seasons: ["spring", "summer"], occasions: ["daily", "work", "special"], sizes: [[3, 4500, 10], [5, 6500, 12], [10, 11500, 6]] },
  { house: "Casa Sol", name: "Menthe Verte", hue: 140, concentration: "Eau de Cologne", family: "Green", audience: "unisex", accords: ["green", "fresh", "citrus"], top: ["mint", "lemon"], heart: ["green tea", "geranium"], base: ["cedar", "musk"], short: "Cool mint and green tea. Clean and calm.", long: "Crisp and refreshing, a modern cologne that disappears into skin in the best way.", longevity: 2, projection: 2, seasons: ["summer", "spring"], occasions: ["daily", "casual", "work"], sizes: [[5, 4800, 18], [10, 8500, 11], [30, 21000, 5]] },
];
for (const item of demo) {
  const made = await admin("POST", "/products", { body: { house: item.house, name: item.name } });
  const productId = made.data.id as string;
  const front = await admin("POST", `/products/${productId}/images`, { form: imageForm({ role: "decant-front", alt: `${item.name} decant, front view`, isRealPhoto: "true" }, bottlePng(item.hue, "front"), "front.png") });
  await admin("PATCH", `/products/${productId}/images/${front.data.id}`, { body: { approved: true } });
  const side = await admin("POST", `/products/${productId}/images`, { form: imageForm({ role: "decant-side", alt: `${item.name} decant, side view`, isRealPhoto: "true" }, bottlePng((item.hue + 12) % 360, "side"), "side.png") });
  await admin("PATCH", `/products/${productId}/images/${side.data.id}`, { body: { approved: true } });
  for (const [sizeMl, priceMinor, stockQuantity] of item.sizes) {
    await admin("POST", `/products/${productId}/variants`, { body: { sku: `${item.name.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase()}-${item.house.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase()}-${sizeMl}`, sizeMl, priceMinor, stockQuantity } });
  }
  await admin("PATCH", `/products/${productId}`, {
    body: {
      ...completeProduct, house: item.house, name: item.name, concentration: item.concentration, family: item.family, audience: item.audience, accords: item.accords,
      notes: { top: item.top, heart: item.heart, base: item.base }, shortDescription: item.short, description: item.long, sourceBrand: item.house,
      longevity: item.longevity, projection: item.projection, seasons: item.seasons, occasions: item.occasions, featured: item.featured ?? false,
    },
  });
  const done = await admin("POST", `/products/${productId}/publish`);
  assert.equal(done.status, 200, `${item.name}: ${JSON.stringify(done.data)}`);
}

await saveSiteSettings(store, {
  businessName: "Esspor Decants",
  announcement: "Order before 8PM for next-day delivery | Mon–Fri",
  whatsapp: "024 555 0199",
  phone: "+233 24 555 0199",
  email: "hello@esspor.example",
  instagram: "esspor.gh",
  pickupNote: "Osu, Accra. Weekdays 10 to 6.",
});

for (const entry of [
  { slug: "local-hero", placement: "home-hero", eyebrow: "Local check", title: "Published hero copy.", body: "First paragraph from the CMS.\n\nSecond paragraph.", ctaLabel: "See the scents", ctaHref: "/shop" },
  { slug: "local-story", placement: "home-story", eyebrow: "From the CMS", title: "Story title from the admin.", body: "Story body served by /api/v1/content." },
]) {
  const created = await admin("POST", "/content", { body: entry });
  await admin("POST", `/content/${created.data.id}/publish`);
}
console.log(`Published local fixture product ${published.data.slug}; 5 ml variant ${five.data.id}.`);
process.exit(0);
