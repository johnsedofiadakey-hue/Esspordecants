// Cloud Functions (2nd gen) entry point. Firebase Hosting rewrites /api/** and
// /media/** on both sites to this function. Bundled to dist/function.js.
import { getRequestListener } from "@hono/node-server";
import { onRequest } from "firebase-functions/v2/https";
import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { openStore } from "./firebase.ts";

const config = loadConfig();
const app = createApp({ store: openStore(config), config });
const listener = getRequestListener(app.fetch);

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
  (req, res) => listener(req, res),
);
