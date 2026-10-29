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

- **The live site has no admin account yet.** Create the owner yourself so the password never passes through anyone else. See the commands in the chat or below:

  ```sh
  gcloud auth application-default login
  cd apps/api && npm run admin:create:live -- --email you@example.com --name "Your Name" --role owner
  ```

- **Restrict the browser API key**. In Google Cloud Console → APIs & Services → Credentials, limit HTTP referrers to `esspordecants.web.app`, `esspordecants-admin.web.app` and the `firebaseapp.com` equivalents, plus `localhost` if needed. The key is public by design, but restricting it limits abuse.
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

## 7. Storefront integration steps for Codex

1. The catalog and product pages need no code change. Build with `VITE_API_BASE_URL=https://esspordecants.web.app`; CI does this.
2. **Bag/checkout**: call `POST /api/v1/checkout/quote` and display the server's prices.
   - Handle `errors[].code`.
   - While `checkoutAvailable` is false, show `checkoutMessage`.
3. **Optional**: use `image.caption` on source-bottle images, `GET /api/v1/families` for filter chips, and `GET /api/v1/content?placement=...` for editorial copy.
4. Do not build order placement yet.
5. Pushing to `main` deploys both sites. See "Deployment (draft 3)" in `SHARED_CONTRACT.md`.
