// Cloud Functions (2nd gen) entry point. Firebase Hosting rewrites /api/** and
// /media/** on both sites to this function. Bundled to dist/function.js.
import { getRequestListener } from "@hono/node-server";
import { defineSecret } from "firebase-functions/params";
import { onRequest } from "firebase-functions/v2/https";
import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { openStore } from "./firebase.ts";

// Set with: firebase functions:secrets:set PAYSTACK_SECRET_KEY (never commit it).
// Deploys fail until the secret exists, which is deliberate: it can't go live half-configured.
const paystackSecret = defineSecret("PAYSTACK_SECRET_KEY");

// Built on the first request, because secret values are only available at runtime.
let listener: ReturnType<typeof getRequestListener> | undefined;
function handler() {
  if (!listener) {
    const config = loadConfig({ paystackSecretKey: paystackSecret.value().trim() || null });
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
    secrets: [paystackSecret],
    // Least-privilege runtime identity: Firestore user, Firebase Auth admin, and
    // object admin on the media bucket only.
    serviceAccount: "esspor-api@esspordecants.iam.gserviceaccount.com",
  },
  (req, res) => handler()(req, res),
);
