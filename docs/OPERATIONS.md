# Operating Esspor: go-live and running checklist

Everything here is something to do **once**, by a person with access to the Firebase and Google Cloud project `esspordecants`. Nothing in this file has been run by Claude against the live project. Scripts are in `scripts/ops/`.

## A. Turning on Paystack (and the optional bot check)

**Deploying never needs any of this.** The site deploys and runs without payment keys: customers are told you will contact them to arrange payment, and checkout stays closed until `CHECKOUT_ENABLED=true`. Do these steps when you are ready to take online payments.

1. **Paystack dashboard**
   - Use **test mode** first. Confirm your Ghana account has GHS and the Mobile Money channel enabled.
   - Set the webhook URL to `https://esspordecants.web.app/api/v1/payments/paystack/webhook` (test and live each have their own).
   - Turn **off** customer emails. Checkout sends a placeholder email built from the phone number because Paystack requires one.
2. **Store the key** (typed at a hidden prompt; needs an owner of the Google Cloud project):

   ```sh
   scripts/ops/set-secrets.sh paystack
   ```

   It enables Secret Manager, stores the key, and lets the API's own identity read that one secret. It then prints a line such as `PAYSTACK_SECRET_NAME=paystack-secret-key`: add it to `apps/api/.env.esspordecants` (it holds a name, not the key) and push to deploy.
3. **Bot check (optional)**: create a free Cloudflare Turnstile widget for `esspordecants.web.app`; run `scripts/ops/set-secrets.sh turnstile` with its **secret** key and add the `TURNSTILE_SECRET_NAME=...` line it prints; add the widget's **site key** (public) to the storefront build as `VITE_TURNSTILE_SITE_KEY` under the storefront build step's `env` in `.github/workflows/deploy.yml`.
4. **Check it took**: `https://esspordecants.web.app/api/v1/health` should show `"payments":"paystack"`. If it still shows `"none"`, the function logs say why (search for `SECRET UNAVAILABLE`), and the admin overview warns when checkout is open without online payment.
5. **Test-mode run** (the only proof against the real Paystack): place an order with a Paystack test card and a test mobile money number, then check the order turns Paid in the admin and `/track` shows "Payment received". Abandon one payment and confirm its stock returns after 45 minutes.
6. **Go live**: run `scripts/ops/set-secrets.sh paystack` again with the **live** key, switch the Paystack webhook to the live URL, set `CHECKOUT_ENABLED=true` in `apps/api/.env.esspordecants`, and deploy.

## B. Create your owner account

```sh
gcloud auth application-default login
gcloud auth application-default set-quota-project esspordecants
cd apps/api && npm run admin:create:live -- --email you@example.com --name "Your Name" --role owner
```

Sign in at https://esspordecants-admin.web.app and look through every screen once.

## C. Fill in the store (admin, no code)

1. **Settings, Store details**: WhatsApp number, phone, email, Instagram, pickup address and hours, and the top banner text. Keep the banner true; it is a promise.
2. **Settings, Delivery options**: add each option (type Delivery or Pickup), set the price, switch it on. Customers can't check out without at least one active option.
3. **Products**: import your catalogue from a spreadsheet (Products, Import from spreadsheet) or add products one by one. Photos, copy approval and publishing happen per product.
4. **Content** (optional): publish entries with the slugs `privacy`, `terms` or `delivery-returns` (placement `page`) to replace the built-in page text. **The built-in wording is a plain-language draft written by Claude, not legal advice. The business owner or a lawyer should read all three before launch**, and check whether registration with Ghana's Data Protection Commission applies.

## D. Cost and safety nets (run once)

```sh
scripts/ops/budget.sh BILLING_ACCOUNT_ID 25     # alerts at 50%, 90%, 100% of a monthly amount; alerts only
scripts/ops/backups.sh                           # daily backups kept 14 days, plus point-in-time recovery
```

Find the billing account id with `gcloud billing accounts list`. Backups cost a little storage; orders cannot be recreated, so they are worth it.

In the Google Cloud console (Monitoring):
- **Uptime check** on `https://esspordecants.web.app/api/v1/health`, alerting your email if it fails for 5 minutes.
- **Alert policy** on Cloud Functions executions with status other than `ok` (error rate), same email.

The function is capped at 10 instances (`maxInstances` in `apps/api/src/function.ts`): the hard ceiling on a traffic spike.

## E. Custom domain (when you have one)

Add the domain in Firebase Hosting (storefront site), follow its DNS steps, then change these and redeploy:

| Where | Change |
|---|---|
| `apps/api/.env.esspordecants` | `PUBLIC_BASE_URL`, `STOREFRONT_ORIGINS` (put the new domain first) |
| `apps/storefront/index.html` | the absolute `og:image` address |
| `apps/storefront/public/robots.txt` | the `Sitemap:` address |
| `.github/workflows/deploy.yml` | `VITE_API_BASE_URL` |
| Paystack | webhook URL |
| Turnstile | allowed domain |

## F. The admin's Content-Security-Policy

The admin site sends its policy as **report-only** (`Content-Security-Policy-Report-Only` in `firebase.json`): it blocks nothing, but the browser console lists anything it would block. After deploying, sign in, open the browser console on each admin screen, and if there are no "Content Security Policy" messages, rename that header to `Content-Security-Policy` to enforce it. The storefront's policy is already enforced and is covered by the automated browser tests.

## G. Running day to day

- **New orders**: tick "Chime and pop up for new orders" in the admin's side menu. It only works while an admin tab is open, and checks once a minute. Paid orders (or, with payment by phone, unpaid ones) show a count beside Orders and in the tab title.
- **Customers have no messages**: they check Track order with their order number. Use "Note for the customer" on an order (rider name and number, ETA, pickup time) so they can see it there. "Message on WhatsApp" opens a chat with the customer if you need to reach them yourself.
- **A payment arrives after the order was cancelled** (it was unpaid for 45 minutes): the order shows a red warning. Refund it in Paystack.
- **Export**: Orders, Export to spreadsheet. Customer names and addresses are defused against spreadsheet formula tricks.

## H. Accepted risks and known limits

- `npm audit` lists 6 moderate advisories in `glob` and `minimatch`, deep inside Google's Firebase SDK (file matching used internally, never fed customer input). Not reachable from the site; they clear when Google updates the SDK.
- Rate limits are per function instance, so they slow a bot but do not stop a determined one. Turnstile does.
- Video seeking is served through the function, not the CDN cache. Fine for a few short clips.
- The admin's screens have no automated tests; the storefront's customer journey does.
