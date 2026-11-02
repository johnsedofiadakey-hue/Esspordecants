// Cloud Functions (2nd gen) entry point. Firebase Hosting rewrites /api/** and
// /media/** on both sites to this function. Bundled to dist/function.js.
import { getRequestListener } from "@hono/node-server";
import { onRequest } from "firebase-functions/v2/https";
import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { openStore } from "./firebase.ts";
import { readSecret } from "./services/secrets.ts";

// The payment and bot-check keys are read from Secret Manager the first time the function
// starts, and only if their names are set in apps/api/.env.esspordecants. Nothing about
// them is needed to deploy. See docs/OPERATIONS.md, section A.
type Listener = ReturnType<typeof getRequestListener>;
let ready: Promise<Listener> | undefined;

async function build(): Promise<Listener> {
  const base = loadConfig();
  const [paystackSecretKey, turnstileSecretKey] = await Promise.all([
    readSecret(base.paystackSecretName, base.projectId),
    readSecret(base.turnstileSecretName, base.projectId),
  ]);
  const config = loadConfig({ paystackSecretKey, turnstileSecretKey });
  return getRequestListener(createApp({ store: openStore(config), config }).fetch);
}

function handler(): Promise<Listener> {
  ready ??= build().catch((error) => {
    ready = undefined; // try again on the next request instead of failing until a restart
    throw error;
  });
  return ready;
}

export const api = onRequest(
  {
    region: "europe-west1",
    memory: "512MiB",
    timeoutSeconds: 60,
    concurrency: 80,
    maxInstances: 10,
    invoker: "public",
    // Least-privilege runtime identity: Firestore user, Firebase Auth admin, and
    // object admin on the media bucket only.
    serviceAccount: "esspor-api@esspordecants.iam.gserviceaccount.com",
  },
  async (req, res) => (await handler())(req, res),
);
