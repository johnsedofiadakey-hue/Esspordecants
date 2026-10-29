# Esspor shared storefront and admin contract (draft 1)

This is the boundary between Codex's public storefront (`apps/storefront`) and Claude's backend/admin. It is a local development contract, not a production deployment approval. Match the field names and routes below or propose changes in this file before implementing a different API.

## Base URL and transport

- Storefront reads `VITE_API_BASE_URL`, defaulting to `http://localhost:4000` in local development.
- JSON over HTTPS in deployed environments; local HTTP is acceptable for development.
- Public read routes return only products with `status: "published"` and approved public assets.
- All monetary values are integer Ghana pesewas (`priceMinor`) with `currency: "GHS"`. The storefront formats currency for display.
- API error shape: `{ "error": { "code": string, "message": string } }` with meaningful HTTP status.

## Public catalog

`GET /api/v1/products?query=&family=&page=&pageSize=` returns:

```json
{
  "items": [
    {
      "id": "product-id",
      "slug": "fragrance-slug",
      "status": "published",
      "house": "Fragrance house",
      "name": "Fragrance name",
      "concentration": "Eau de Parfum",
      "family": "Woody",
      "shortDescription": "Approved public copy.",
      "heroImage": { "url": "https://...", "alt": "Actual Esspor decant front view", "role": "decant-front" },
      "minPriceMinor": 0,
      "currency": "GHS",
      "available": true
    }
  ],
  "page": 1,
  "pageSize": 12,
  "total": 1
}
```

`GET /api/v1/products/:slug` returns the listing fields plus `description`, `notes` (`top`, `heart`, `base` string arrays), `images` (each `{url,alt,role}`), `sourceBrand`, `authenticityCopy`, `whatArrives`, and `variants`:

```json
{
  "id": "variant-id",
  "sku": "ESS-...",
  "sizeMl": 5,
  "priceMinor": 0,
  "currency": "GHS",
  "available": true,
  "stockStatus": "in_stock",
  "image": { "url": "https://...", "alt": "Actual 5 ml Esspor decant", "role": "decant-front" }
}
```

Allowed image roles: `decant-front`, `decant-side`, `sprayer`, `source-bottle`, `packaging`, `editorial`. The first product image should show what the shopper receives. Source-bottle images must be identified as such. Variant `image` is optional when the actual bottle is the same across sizes, but required when the size changes the bottle appearance. The storefront shows it on size selection. The admin should capture bottle material, cap/sprayer type, label version, and size-specific packaging notes so every published variant matches what ships. Exact decant sizes and physical bottle/label appearance are pending merchant confirmation; 2, 5, and 10 ml in mockups are illustrative.

## Checkout boundary

The storefront may keep a local bag, but server authority determines final price, availability, shipping, and payment status. `POST /api/v1/checkout/quote` accepts `{ items: [{ variantId, quantity }] }` and returns authoritative line totals, subtotal, delivery options, final total, and availability errors. Order placement and payment endpoints must be agreed after payment and fulfilment methods are confirmed. Do not accept client-calculated prices or trust client stock.

## Admin ownership

Claude owns authentication/authorization, product CRUD and image upload, editorial CMS, published state, stock, order lifecycle, checkout/payment/fulfilment services, and API validation. The admin must not publish placeholder or generated concept imagery as real product photography. A product needs a real fragrance name/house, approved description, at least one actual decant photo, at least one size variant with price, and an approved published state before appearing in public reads. Never place credentials in public assets or commit them.

## Local integration states

The public storefront must show a clear empty state while no products are published. It must not show invented products or enable a real purchase against a missing API. Use synthetic records only in tests or an explicitly marked preview route. Live payment, production data, and deployment require separate verification.

## Implemented by Claude, with proposed additions (draft 2, 2026-10-29)

Everything in draft 1 is implemented as written. The items below are **additive**: no existing field or route changed, so the current storefront works unmodified. Codex, please confirm or push back here before relying on them.

### Clarifications of draft 1

- `stockStatus` is one of `"in_stock" | "low_stock" | "out_of_stock"`. `available` is `stockStatus !== "out_of_stock"`.
- `images` are ordered `decant-front`, `decant-side`, `sprayer`, `packaging`, `source-bottle`, `editorial`. `heroImage` is always an approved real `decant-front` photo (a publish gate guarantees one exists).
- Image `url`s are absolute (`${PUBLIC_BASE_URL}/media/<file>`) and only resolve while the image is approved and attached to a published product or published content entry.
- Variants with `priceMinor` 0 or marked inactive are omitted from public reads.
- Errors may carry an optional `details` array (validation issues or failing publish checks): `{ "error": { "code", "message", "details"? } }`.
- `pageSize` is capped at 48. Search (`query`) matches house, name, family, short description and notes; it ignores case and accents ("cedre" matches "Cèdre"). `family` filtering also ignores case and accents.

### Proposed: optional `caption` on images

`source-bottle` images carry `caption: "Original full-size bottle, shown for reference. You receive an Esspor decant."` so the storefront can label them without hard-coding copy. Other roles omit it.

### Proposed: `GET /api/v1/families`

`{ "items": [{ "name": "Woody", "count": 3 }] }` — families that have at least one published product, for filter chips.

### Proposed: editorial content

`GET /api/v1/content?placement=home-story` → `{ "items": ContentEntry[] }`; `GET /api/v1/content/:slug` → `ContentEntry` (404 unless published).

```json
{
  "slug": "our-promise",
  "placement": "home-story",
  "eyebrow": "Our promise",
  "title": "Authentic, portioned",
  "body": "Plain text. Blank lines separate paragraphs.",
  "cta": { "label": "Shop decants", "href": "/shop" },
  "image": { "url": "https://...", "alt": "...", "role": "editorial" },
  "updatedAt": "2026-10-29T12:00:00.000Z"
}
```

`cta` and `image` may be `null`. Known placements: `home-hero`, `home-story`, `home-feature`, `announcement`, `page`. Render `body` as text, never as HTML.

### Implemented: `POST /api/v1/checkout/quote` response

Request: `{ "items": [{ "variantId", "quantity" }], "deliveryOptionCode"?: string }`. Any client price field is ignored. Duplicate variant ids are merged. Max 20 lines; max 10 per size.

```json
{
  "currency": "GHS",
  "items": [
    { "variantId": "...", "productId": "...", "slug": "...", "sku": "ESS-...", "house": "...", "name": "...",
      "sizeMl": 5, "quantity": 2, "unitPriceMinor": 12000, "lineTotalMinor": 24000, "available": true }
  ],
  "errors": [{ "variantId": "...", "code": "insufficient_stock", "message": "Only 3 available.", "availableQuantity": 3 }],
  "subtotalMinor": 24000,
  "deliveryOptions": [{ "code": "accra-courier", "label": "...", "description": "...", "priceMinor": 2500 }],
  "selectedDeliveryOptionCode": null,
  "deliveryMinor": 0,
  "totalMinor": 24000,
  "checkoutAvailable": false,
  "checkoutMessage": "Online checkout is not open yet. Payment and delivery are being finalised."
}
```

Error codes: `variant_unavailable` (unknown, unpublished or inactive — remove from bag), `out_of_stock`, `insufficient_stock` (use `availableQuantity`), `quantity_limit`, `delivery_option_unavailable` (has `variantId: ""`). Lines with `available: false` are excluded from `subtotalMinor`. While `checkoutAvailable` is false the storefront should show `checkoutMessage` and keep the place-order button disabled.

### Proposed (closed by default): `POST /api/v1/orders`

Returns `503 checkout_unavailable` until the server runs with `CHECKOUT_ENABLED=true`, which must wait for a confirmed payment provider and delivery policy. Shape, for planning only:

Request: quote request plus `customer: { name, email, phone, address: { line1, line2?, city, region, notes? } }`.
Response `201`: `{ "order": { "number", "status": "pending_payment", "totalMinor", "currency", "items": [...] }, "payment": { "provider": "none", "status": "not_configured", "reference": null, "message": "..." } }`.
Failures: `409 quote_changed` (with `details.quote` — re-show the bag), `422 delivery_required`, `422 empty_order`. The payment block will change once a provider is chosen.

## Deployment (draft 3, 2026-10-29): Firebase

No route or field above changed. What changed is where things run:

- **Hosting**: the storefront is the Firebase Hosting site `esspordecants` (https://esspordecants.web.app). The admin is the separate site `esspordecants-admin` (https://esspordecants-admin.web.app).
- **API**: one Cloud Function, `api`, in `europe-west1`. Both sites rewrite `/api/**` to it, and the storefront also rewrites `/media/**`. The public API is therefore same-origin on the storefront at `https://esspordecants.web.app/api/v1/...`.
- **Storefront build**: set `VITE_API_BASE_URL=https://esspordecants.web.app` at build time. The GitHub Actions workflow already does this. Local development is unchanged and still uses `http://localhost:4000`.
- **Media URLs**: these are now `https://esspordecants.web.app/media/<file>`. They still resolve only while the image is approved and attached to something published. Public GETs send `Cache-Control: public, max-age=30, s-maxage=60`, so a publish or unpublish can take up to about a minute to show.
- **Deploys**: every push to `main` runs the API tests, builds both sites and deploys (`.github/workflows/deploy.yml`). Codex, storefront changes go live on merge to `main`.

## Storefront data wiring (2026-10-29, Claude, per the handoff follow-up)

The draft 2 proposals (`caption`, `/families`, `/content`) are now used by the storefront. No API shape changed.

- **Bag** (`/bag`):
  - The bag sends only `{ variantId, quantity }` to `POST /api/v1/checkout/quote` and re-quotes on every change.
  - Line totals and the subtotal come from the quote. Prices saved in the browser are never shown.
  - `variant_unavailable` and `out_of_stock` lines show the server message and a Remove action.
  - `insufficient_stock` offers "Use N", using `availableQuantity`.
  - `checkoutMessage` is shown, and the checkout button stays disabled until order placement is built.
- **Shop filter**: options come from `GET /api/v1/families`. The four previous families are a fallback while it loads or if it fails. A family arriving from a link (a mood card) stays selectable, matched without regard to case or accents.
- **Product page**:
  - Source-bottle images show `caption` under the main image, using the existing `.concept-note` style.
  - The "Editorial concept" label now appears only on `/preview/product`; real editorial images say "Editorial".
- **Home**:
  - A published `home-hero` entry replaces the hero eyebrow, title, copy and primary button. If it has an image, that image replaces the background and the "Concept imagery" caption is hidden.
  - A published `home-story` entry replaces the intro section.
  - With nothing published, the built-in copy is unchanged.
  - The content swaps in inside the existing `data-reveal` elements, so the motion is unaffected.
- **Not rendered yet**: `home-feature` and `announcement`. Codex, these need a visual treatment from you. Data is available from `GET /api/v1/content?placement=...`.
- **CSS added**: one rule at the end of `styles.css`, `button.text-link`, so bag actions look like the existing text links. Restyle it as you see fit.
