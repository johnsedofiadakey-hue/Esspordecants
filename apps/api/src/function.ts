// Cloud Functions (2nd gen) entry point. Firebase Hosting rewrites /api/** and
// /media/** on both sites to this function. Bundled to dist/function.js.
import { getRequestListener } from "@hono/node-server";
import { defineSecret } from "firebase-functions/params";
import { onRequest } from "firebase-functions/v2/https";
import { createApp } from "./app.ts";
import { loadConfig, secretOrNull } from "./config.ts";
import { openStore } from "./firebase.ts";

// Set both with scripts/ops/set-secrets.sh (never commit them). Deploys fail until they
// exist, which is deliberate: the site can't go live half-configured. The value "off"
// switches a feature off: payment by phone instead of Paystack, or no bot check.
const paystackSecret = defineSecret("PAYSTACK_SECRET_KEY");
const turnstileSecret = defineSecret("TURNSTILE_SECRET_KEY");

// Built on the first request, because secret values are only available at runtime.
let listener: ReturnType<typeof getRequestListener> | undefined;
function handler() {
  if (!listener) {
    const config = loadConfig({ paystackSecretKey: secretOrNull(paystackSecret.value()), turnstileSecretKey: secretOrNull(turnstileSecret.value()) });
    listener = getRequestListener(createApp({ store: openStore(config), config }).fetch);
  }
  return listener;
}

export const api = onRequest(
  {
    region: "europe-west1",
    memory: "512MiB",
    timeoutSeconds: 60,
    concurrency: 80,
    maxInstances: 10,
    invoker: "public",
    secrets: [paystackSecret, turnstileSecret],
    // Least-privilege runtime identity: Firestore user, Firebase Auth admin, and
    // object admin on the media bucket only.
    serviceAccount: "esspor-api@esspordecants.iam.gserviceaccount.com",
  },
  (req, res) => handler()(req, res),
);
