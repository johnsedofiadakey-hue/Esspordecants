import { getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import type { Config } from "./config.ts";

export type Bucket = ReturnType<ReturnType<typeof getStorage>["bucket"]>;

export type Store = {
  db: Firestore;
  auth: Auth;
  bucket: Bucket;
};

// Uses Application Default Credentials in Cloud Functions and locally, or the
// emulators when FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST /
// FIREBASE_STORAGE_EMULATOR_HOST are set.
export function openStore(config: Config): Store {
  const app: App = getApps()[0] ?? initializeApp({ projectId: config.projectId });
  const db = getFirestore(app);
  try {
    db.settings({ ignoreUndefinedProperties: true });
  } catch {
    // settings() may only be called once per instance; later calls reuse it.
  }
  return { db, auth: getAuth(app), bucket: getStorage(app).bucket(config.mediaBucket) };
}

export const COLLECTIONS = {
  admins: "admins",
  products: "products",
  library: "libraryImages",
  content: "content",
  delivery: "deliveryOptions",
  orders: "orders",
  stock: "stockMovements",
  audit: "audit",
  counters: "counters",
} as const;
