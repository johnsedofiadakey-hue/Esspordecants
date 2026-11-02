# Claude report: Esspor API and admin portal

Status as of 2026-10-29. Covers what `docs/CLAUDE_HANDOFF.md` asked for, plus the move to Firebase that the user chose ("Full backend", "Deploy for me", "Push, then auto-deploy", region europe-west1).

**Live**:
- Storefront: https://esspordecants.web.app
- Admin: https://esspordecants-admin.web.app

The public catalog is empty. No real products are published, no payment provider is connected, and checkout is closed (`CHECKOUT_ENABLED=false`).

## 1. Architecture

| Piece | Where it runs |
|---|---|
| API (`apps/api`) | One Cloud Function (2nd gen), `api`, in europe-west1, Node 22. Hono app, bundled with esbuild into `dist/function.js`. |
| Data | Firestore (native mode, europe-west1, default database). |
| Images | Private Cloud Storage bucket `esspordecants-media` in europe-west1, with uniform access and public access prevention enforced. Files are served only through the API. |
| Admin sign-in | Firebase Authentication with email/password. Public sign-up and self-deletion are disabled at the project level. |
| Storefront and admin | Two Firebase Hosting sites. Both rewrite `/api/**` to the function, and the storefront also rewrites `/media/**`. |
| Runtime identity | Service account `esspor-api@`, with Firestore user, Firebase Auth admin, and object admin on the media bucket only. |
| CI/CD | GitHub Actions authenticates through Workload Identity Federation (no stored keys) as `github-deployer@`. The provider only trusts `refs/heads/main` of `johnsedofiadakey-hue/Esspordecants`. |

Firestore and Storage security rules deny all client access. Only the API, through the Admin SDK, reads or writes data.

## 2. What was implemented

### `apps/api`

- **Admin authentication** (`src/auth/middleware.ts`):
  - The admin signs in with the Firebase client SDK and sends the ID token as `Authorization: Bearer`.
  - The API checks the token with revocation checking on. The uid must also have an active `admins/{uid}` record, so a valid Firebase user without that record gets `403 not_an_admin`.
  - There are no cookies, so there is no CSRF surface.
  - There are two roles. `owner` can do everything. `editor` can do everything except manage admins, change delivery options or read the audit log.
  - **Settings → Team** (owner only): add an admin (password at least 12 characters), change a role, disable or re-enable an account, or reset a password. Disabling an account or resetting its password revokes that person's tokens at once. An owner cannot disable or demote themselves, and at least one active owner must remain; this is checked in a transaction.
  - **Your password**: handled in the browser by Firebase. You re-enter your current password first, and Firebase signs out your other devices.
- **Data model**: one Firestore document per product, with its size variants and images embedded.
  - Every product write goes through `mutateProduct`, which runs a transaction and re-checks the publish gate when the product is live. An edit that would break a live product is rejected with `422 publish_gate_failed`.
  - The derived arrays `variantIds`, `skus` and `publicFiles` are recomputed on every write. They support variant lookup, SKU uniqueness, and the media rule that only published files are served.
- **Collections**: `admins`, `products`, `libraryImages` (editorial library), `content`, `deliveryOptions`, `orders` (items and timeline embedded), `stockMovements`, `audit`, `counters`.
- **Images**:
  - The file type is detected from the file's content (JPEG/PNG/WebP). Limits: 8 MB maximum, at least 400×400 pixels.
  - Approval needs alt text. Physical roles also need a real-photo confirmation. Source-bottle alt text must say it shows the original bottle.
  - `/media/:file` serves a file only if it appears in `publicFiles` on a published, non-sample product or on published content. The admin previews drafts through the authenticated `/api/admin/media/:file`.
- **Publish gates, quote, orders, delivery options, CMS, audit log**: same behaviour as before.
  - Prices and stock are decided by the server.
  - Order placement and stock changes run in Firestore transactions, so stock cannot go negative.
  - Cancelling or refunding before shipping restores stock.
- **Payment**: isolated behind `PaymentAdapter`. The only adapter is `none`. `POST /api/v1/orders` returns 503 until `CHECKOUT_ENABLED=true`.
- **Search**: Firestore has no substring search, so published products are filtered in memory. Search ignores accents and case. This suits a catalogue of up to a few hundred products.
- **Caching**: public GETs send `Cache-Control: public, max-age=30, s-maxage=60`, so the Hosting CDN absorbs read traffic.

### `apps/admin`

- Firebase Auth sign-in.
  - In production, the config is loaded from Hosting's `/__/firebase/init.json`, so no project values are baked into the bundle.
  - In development, the admin connects to the Auth emulator with an offline demo project.
- The ID token is attached to every API call. Draft images are fetched with the token and shown from object URLs (`AuthImage`).
- The admin uses the nested routes for variants and images (§4).
- Pages, layout and the Esspor look are unchanged from the earlier version.

### Scripts (`apps/api/scripts/`)

- **`seed.ts`** (emulators only; refuses otherwise) creates:
  - An owner account.
  - 3 synthetic draft products flagged `isSample`, which can never be published.
  - 3 synthetic orders.
  - 2 draft content entries.
  - 1 inactive delivery option.

  The generated owner password is written to the gitignored `data/dev-admin-credentials.txt` and never printed.
- **`create-admin.ts`** adds an admin. The password comes from a hidden prompt or `ADMIN_PASSWORD`. Run it with `admin:create` for the emulators or `admin:create:live` for production.

## 3. Setup and run locally

Requires Node 22+, Java 21+ (for the Firebase emulators) and `firebase-tools`.

```sh
cd apps/api && npm install
npm run emulators           # Auth 9099, Firestore 8080, Storage 9199 (project demo-esspor, offline)
npm run seed                # in a second terminal
npm run dev                 # API on http://localhost:4000
```

```sh
cd apps/admin && npm install && npm run dev    # http://localhost:5180
```

- Sign in as `admin@esspor.local`. The password is in `apps/api/data/dev-admin-credentials.txt`.
- `npm test` in `apps/api` starts the emulators, runs the tests and shuts them down.
- `npm run typecheck` and `npm run build` are also available.

## 4. Routes

The public routes are unchanged; see `SHARED_CONTRACT.md`.

Admin routes are under `/api/admin` and need `Authorization: Bearer <Firebase ID token>`:

- **Me**: `GET auth/me`.
- **Products**:
  - `GET|POST products`
  - `GET|PATCH|DELETE products/:id`
  - `POST products/:id/{publish,unpublish,archive,restore}`
- **Variants**:
  - `POST products/:id/variants`
  - `PATCH|DELETE products/:id/variants/:variantId`
  - `GET|POST products/:id/variants/:variantId/stock`
- **Product images**:
  - `POST products/:id/images` (multipart)
  - `PATCH|DELETE products/:id/images/:imageId`
- **Library**: `GET|POST images`, `PATCH|DELETE images/:imageId`. **Media**: `GET media/:file`.
- **Content**: `GET|POST content`, `GET|PATCH|DELETE content/:id`, `POST content/:id/{publish,unpublish}`.
- **Orders**: `GET orders`, `GET|PATCH orders/:id`, `POST orders/:id/status`, `POST orders/:id/notes`.
- **Settings**: `GET summary`, `GET|POST delivery-options`, `PATCH|DELETE delivery-options/:id`, `GET audit`.
- **Team** (owner only): `GET|POST users`, `PATCH users/:id`, `POST users/:id/password`.

Removed in this version: `auth/login`, `auth/logout` and `auth/password`. Firebase handles all three in the browser.

## 5. Verification

- **Tests**: `npm test` passes 21 of 21 tests against the Firebase emulators. They cover:
  - Token checks: a missing token, a forged token, and a non-admin Firebase user are each rejected.
  - Publish gates.
  - Upload sniffing and size checks.
  - Image approval rules.
  - Public reads: decant photo first, contract field set, accent-insensitive search.
  - Rollback of edits that break a live product.
  - Private drafts and media.
  - Quote authority.
  - Checkout closed, plus the transactional order and restock flow.
  - Stock log.
  - Sample products cannot be published.
  - CMS, including rejection of `javascript:` links.
  - CORS.
  - Team management, including token revocation on disable and on password reset.
- **Builds**: the API typecheck, the admin build (`tsc` + Vite) and the function bundle all pass.
- **Browser, locally**: the admin sign-in screen talks to the Auth emulator, and a wrong password shows "Email or password is incorrect." I did not sign in as the seeded owner in the browser, so the signed-in admin screens have not been checked by eye on Firebase yet. They were checked on the earlier version; this version is covered by the API tests and the admin's typecheck.
- **Live smoke test**:
  - `GET /api/v1/health` returns 200 with `checkoutEnabled: false`.
  - `/api/v1/products` and `/api/v1/families` return empty lists.
  - `/api/admin/products` returns 401 without a token, on both sites.
  - An unknown `/media` file returns 404.
  - Both sites return 200, and the admin sends `X-Robots-Tag: noindex` and `X-Frame-Options: DENY`.

## 6. Open items

- **Live owner account**: the owner creates it themselves so the password never passes through anyone else. Run:

  ```sh
  gcloud auth application-default login
  gcloud auth application-default set-quota-project esspordecants
  cd apps/api && npm run admin:create:live -- --email you@example.com --name "Your Name" --role owner
  ```

  The quota-project step is required. Otherwise Auth admin calls are billed to whatever default project gcloud has.
- **Browser API key**: done on 2026-10-29. The key "Browser key (auto created by Firebase)" now accepts only the `https://esspordecants.web.app/*` and `https://esspordecants-admin.web.app/*` referrers and their `firebaseapp.com` equivalents. Its 27 allowed APIs are unchanged. Local development uses the Auth emulator, so it does not need this key.
- **Signed-in admin screens in a browser**: still to be checked by eye on Firebase. This needs the owner to sign in, because credentials are never typed by Claude.
- **Firebase Storage default bucket**: not created. Media uses the private custom bucket, so `firebase/storage.rules` is only used by the emulator.
- **Blocked on decisions**:
  - Payment provider.
  - Delivery policy and prices.
  - Confirmed decant sizes, bottle, cap and label.
  - First real products and photos.
- **Not built yet**:
  - Customer emails or SMS.
  - Image thumbnails (originals are served, with a 1-hour cache).
  - Admin accounts can only be disabled, never deleted.
- **The repository is public**, so the mockups and brand assets in it are public too.

## 7. Storefront data wiring (done by Claude after the handoff follow-up)

- The bag quotes `POST /api/v1/checkout/quote` and shows server prices and errors. Checkout stays disabled.
- The shop filter is built from `/api/v1/families`.
- Source-bottle captions are shown on the product page.
- Published `home-hero` and `home-story` content replaces the built-in copy.
- Details are in `SHARED_CONTRACT.md` → "Storefront data wiring".
- **Verified locally**: `npm run fixtures:local` (emulators running) wipes the local emulators and publishes one synthetic product and two content entries through the API. In the browser:
  - The hero and story showed the CMS copy, with reveal and parallax intact.
  - `?family=woody` selected "Woody".
  - The source-bottle caption appeared.
  - A bag line with its stored price tampered to 1 still showed the server's GH₵240.00.
  - Over-stock quantity showed "Only 2 available. Use 2", and the button fixed it.
  - A retired variant showed "no longer available" with a working Remove.

## 8. Storefront integration steps for Codex (original list, now done except order placement)

1. The catalog and product pages need no code change. Build with `VITE_API_BASE_URL=https://esspordecants.web.app`; CI does this.
2. **Bag/checkout**: call `POST /api/v1/checkout/quote` and display the server's prices.
   - Handle `errors[].code`.
   - While `checkoutAvailable` is false, show `checkoutMessage`.
3. **Optional**: use `image.caption` on source-bottle images, `GET /api/v1/families` for filter chips, and `GET /api/v1/content?placement=...` for editorial copy.
4. Do not build order placement yet.
5. Pushing to `main` deploys both sites. See "Deployment (draft 3)" in `SHARED_CONTRACT.md`.

## 9. Media uploads and one-page checkout (2026-11-02)

Requested by the merchant: several images and videos per product, a short customer journey, and a checkout that asks only for a full name, a phone number and (for delivery) an address, with a choice of pickup or delivery.

**Media**
- `apps/api/src/services/images.ts`: videos (MP4, MOV, WebM) are accepted next to photos, detected by content. `kind` is stored per file; records without it are photos. Limits: photos 5 MB, videos 20 MB, 16 photos and 4 videos per product (see section 10 and `docs/AUDIT_2026-11-02.md`).
- Media is streamed with `Range` support (`mediaResponse`) on both `/media/:file` and the admin preview route.
- Hero images, variant photos and the "real decant-front photo" publish gate only ever use photos. The editorial library still takes photos only.
- Admin, **Photos and videos**: pick many files at once, with one shared role and real-media confirmation; add the description per item afterwards, then approve. Cards play videos and have earlier/later buttons for ordering within a role.
- Storefront product page: thumbnails show a play badge for videos, and selecting one plays it in the main viewer.
- **Open risk**: uploads and video playback go through the Cloud Function (32 MiB request limit) behind Firebase Hosting. This is why videos are capped at 20 MB. It was verified against the emulators and a local build only, not on the live site. Longer videos would need direct-to-storage signed uploads.

**Checkout**
- `/bag` is bag and checkout on one page. Fulfilment options come from Settings → Delivery options, which now have a type (Delivery or Pickup).
- The order takes `customer: { name, phone, address? }`. Address is required only for delivery (`422 address_required`). The email field is gone; the admin shows the phone number as a tap-to-call link, and orders are searchable by phone.
- Checkout still stays closed until `CHECKOUT_ENABLED=true`, a payment provider is chosen and delivery options are active.

**Verification**
- `npm test` in `apps/api` (JDK 21, `JAVA_HOME=/opt/homebrew/opt/openjdk@21`): 23 of 23 pass. New tests cover video upload and sniffing, photo-first ordering, range responses, size limits, library rejecting video, pickup and delivery orders, and `address_required`.
- API typecheck, admin build and storefront build pass.
- A headless Chrome run against the emulators and a local build covered: mixed gallery with video, add to bag, pickup then courier (fee added to the total), address field appearing only for delivery, browser-side validation blocking an empty form, order placed with a confirmation and an emptied bag, and no horizontal scroll at 390 px.
- **Not checked by eye**: the admin screens (typecheck and build only) and a real, playable video. The local fixture's video bytes are not a real video.

## 10. Keeping Firebase costs down (2026-11-02)

Served bytes (egress), function time and Firestore reads are what grow with traffic. Changes made:

- **Smaller media in**: the admin shrinks photos in the browser to at most 1800 px WebP before upload (a 4000×3000 test image became 1800×1350). Server caps: photos 5 MB, videos 20 MB, 16 photos and 4 videos per product (`media_limit`).
- **Smaller media out**: the two concept images on the home and product pages go from 1.9 MB and 1.5 MB (PNG) to 91 KB and 25 KB (WebP). The PNG originals are still in `public/concept` but no longer referenced. Gallery thumbnails and bag images load lazily.
- **Videos only download when played**: the main viewer uses `preload="none"` and video thumbnails are a static play tile, so opening a product page no longer fetches any video bytes.
- **Caching**: public media is cached for a day at the CDN and browser (`public, max-age=86400, s-maxage=86400`; was an hour), and `/brand/**` and `/concept/**` for a week. Cost: unpublishing or deleting media takes up to a day to disappear from the CDN.
- **Fewer Firestore reads**: a media request now costs one read, not two. The published catalogue is held in memory for 30 seconds (`catalogCacheMs`) and cleared by our own writes, so a bot changing `?query=` to dodge the CDN costs one scan per 30 seconds per instance, not one per request.
- **Verification**: API tests 25 of 25 (new: media caps, cache header, catalogue cache). The photo shrinking was run in headless Chrome. Dollar savings were not measured.

**Still open**:
- Video range requests (`206`) are not cached by the Hosting CDN, so seeking in a video reaches the function. Fine for a few short clips; for heavier video use, serve from Cloud Storage with signed URLs or put the media behind Cloud CDN.
- No billing budget or alert exists yet. Create one (it only alerts, it does not cap spending):

  ```sh
  gcloud billing budgets create --billing-account=BILLING_ACCOUNT_ID \
    --display-name="Esspor monthly" --budget-amount=25USD \
    --threshold-rule=percent=0.5 --threshold-rule=percent=0.9 --threshold-rule=percent=1.0
  ```
- `maxInstances: 10` on the function is the hard ceiling on a traffic spike; lower it if you would rather refuse traffic than pay for it.

## 11. Paystack payments and order tracking (2026-11-02)

**What it does.** Place order saves the order (stock reserved), then asks Paystack for a payment link and redirects the customer. Paystack's webhook, or the customer coming back to Track order, marks it paid. Track order (`/track`) shows a four-step progress bar and history from just the order number. The confirmation page shows the number large with "Take a screenshot of this page", and the last five numbers are remembered in the browser. Details of every route are in `SHARED_CONTRACT.md` (draft 5).

**Main files**: `apps/api/src/services/payments.ts` (adapter), `services/orders.ts` (payment start, success, expiry, public order view), `routes/public.ts` (track, pay, webhook), `lib/rateLimit.ts`, `apps/api/src/function.ts` (secret), `apps/storefront/src/main.tsx` (`Track`, confirmation, redirect), admin Orders (warnings for late or mismatched payments).

**Setup** (superseded by `docs/OPERATIONS.md`, section A: keys are now read from Secret Manager at runtime and deploys never depend on them. The steps below that mention `firebase functions:secrets:set`, a manual first deploy, or failing deploys no longer apply.)
1. In Paystack, start with **test mode**. Confirm your Ghana account has GHS and the Mobile Money channel enabled.
2. Store the test secret key (it is typed at the prompt, never put in the repo or chat):

   ```sh
   firebase functions:secrets:set PAYSTACK_SECRET_KEY --project esspordecants
   ```
3. **Deploy the function by hand once** so Firebase can grant the function access to the secret: `firebase deploy --only functions --project esspordecants`. Pushing to `main` before step 2 makes the CI deploy fail (production keeps running the previous version). If CI then still fails on secret permissions, the `github-deployer` account needs Secret Manager admin rights; keep deploying functions by hand until that is granted.
4. In the Paystack dashboard (Settings, API Keys and Webhooks), set the **test webhook URL** to `https://esspordecants.web.app/api/v1/payments/paystack/webhook`. The return page is sent with each payment, so no callback URL is needed there.
5. In Paystack's preferences, **turn off emails to customers**. Paystack requires an email, so checkout sends a placeholder built from the phone number (`233241234567@customers.esspordecants.web.app`, domain set by `PAYMENT_EMAIL_DOMAIN`); nothing should be mailed to it.
6. Add active delivery options, set `CHECKOUT_ENABLED=true` in `apps/api/.env.esspordecants`, and deploy.
7. Place a test order with Paystack's test card and test mobile money numbers, then check: the order turns Paid in the admin, `/track` shows "Payment received", and a deliberately abandoned payment frees its stock after 45 minutes.
8. Go live by setting the secret to the **live** key and the webhook to the live URL, then redeploy.

**Verification**
- API tests: **32 of 32** (7 new) against a fake Paystack server: payment start (amount, currency, placeholder email, return link), tracking with a no-personal-data check, signed webhook (bad signature, short payment, repeat delivery), return-page confirmation without a webhook, Paystack outage then retry, expiry with stock restored and a late payment flagged, and the rate limit.
- Browser: a real purchase in the preview browser against the real API with the Paystack adapter on and a local stand-in for Paystack: order placed, redirected to the payment page, marked paid there, returned to `/track` showing "Payment received". The no-Paystack path shows the screenshot notice.
- **Not verified, and the main risk**: nothing has talked to the real Paystack. Paystack's own documentation could not be fetched here, so the request shape (amount in pesewas, `currency: "GHS"`, email, `callback_url`, `reference`) and the webhook fields follow its public API as known and as described by third-party references. Step 7 in test mode is what proves it.

**Known limits**
- A customer who loses their order number cannot find the order (by design; the merchant can search by phone in the admin).
- Orders stay `Pending payment` for 45 minutes if the customer abandons the Paystack page; stock is held until then.
- Rate limiting is per function instance, so it is a speed bump, not a full bot defence (see the audit).

## 12. Launch features, tests and operations (2026-11-02)

Everything in `docs/AUDIT_2026-11-02.md` that did not depend on a business decision or on access to the live project is now built. The runbook for the rest is `docs/OPERATIONS.md`.

**Customers**
- Store details (WhatsApp, phone, email, Instagram, pickup note, top banner) editable in the admin; footer, contact page and "Message us on WhatsApp" help links on the confirmation and tracking pages use them. The banner hides if left empty.
- Privacy, Terms, Delivery & returns and Contact pages. **The default wording is a plain-language draft, not legal advice**; the owner or a lawyer must read it before launch, and any of the three can be replaced from the admin Content screen.
- A merchant "Note for the customer" appears on Track order (the replacement for messages).
- Per-page titles, a favicon, default social tags, a skip-to-content link, noindex on bag, track and not-found pages, and a deeper orange for small text (contrast 5.3:1, was 3.5:1).
- Shared product links show the product's own title, picture and price (see the contract); `/sitemap.xml` and `/robots.txt` are generated.

**Abuse protection**: hidden honeypot field, per-phone cap of three unpaid orders, per-minute rate limits, and an optional Cloudflare Turnstile check (needs a site key at build and a secret; off by default).

**Admin**: Store details card; bulk product import from a spreadsheet (check first, drafts only, never overwrites); order export to a spreadsheet with formula defusing; packing-slip print; "Message on WhatsApp" link on orders; 30-day sales on the overview; a chime, pop-up and count for new orders while an admin tab is open.

**Security headers**: the storefront now enforces a Content-Security-Policy and Permissions-Policy (verified against a real build in a real browser: no violations). The admin's policy is report-only until it has been checked signed in on the live site (OPERATIONS.md, section F).

**Found by the new browser test and fixed**: the phone field's validation pattern was invalid in current Chrome (so it silently did not validate); the thumbnail row widened the page on phones; legal pages were making needless 404 requests.

**Verification**
- API: `npm test` **40 of 40**, plus new coverage for store details, customer notes, bot guards, order export, the importer, link previews and the sitemap.
- **New: `npm run e2e`** (`apps/api/e2e/browser.test.ts`, 7 tests, also run in the deploy pipeline): a production build of the storefront served like Hosting with the real headers, the real API on the emulators, a stand-in for Paystack, and headless Chrome. It covers the banner, product link previews, no video download until play, a full pickup order through payment and back to Track order, typing an order number by hand, an unknown number, all information pages, a 404, no sideways scrolling on a phone across seven pages, and the sitemap. It fails on any console error, including security-policy violations.
- Spreadsheet reader checked on the template and an Excel-style file (BOM, semicolons, quoted line breaks).
- Typechecks and builds for all three apps.
- Looked at by eye in the preview browser: contact page, footer, admin Store details, admin import page, admin order screens.

**Not done, and why**
- Nothing here touches the live project. Secrets, backups, the budget alert, uptime checks, the custom domain and the Paystack test-mode run are in OPERATIONS.md for a person with access.
- The admin screens have no automated tests, and a file upload through the import page was not exercised in a browser (the parser and the API are each tested).
- Discount codes, a customers list and sales reports beyond the 30-day figures were not asked for and are not built.
- Videos still have no captions.
- Real photography replaces the generated concept images on the home page; until then their "concept" captions stay.
