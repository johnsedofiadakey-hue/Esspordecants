// Local development server. Point it at the Firebase emulators (see package.json "dev").
import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { openStore } from "./firebase.ts";

const config = loadConfig();
const app = createApp({ store: openStore(config), config });

serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  console.log(`Esspor API listening on http://${info.address}:${info.port} (project ${config.projectId})`);
  console.log(`Checkout ${config.checkoutEnabled ? "ENABLED" : "disabled (quote only)"}`);
  if (!process.env.FIRESTORE_EMULATOR_HOST) console.warn("FIRESTORE_EMULATOR_HOST is not set: this server is using the LIVE Firebase project.");
});
