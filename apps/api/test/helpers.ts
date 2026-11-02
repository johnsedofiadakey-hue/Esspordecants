import zlib from "node:zlib";
import { createApp } from "../src/app.ts";
import { loadConfig, type Config } from "../src/config.ts";
import { openStore } from "../src/firebase.ts";
import { createAdmin } from "../src/routes/admin/users.ts";

// Tests run inside `firebase emulators:exec` (npm test) against the demo-esspor project.
export const ADMIN_EMAIL = "owner@test.local";
export const ADMIN_PASSWORD = "correct-horse-battery";

const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if (!firestoreHost || !authHost) throw new Error("Run the tests with npm test so the Firebase emulators are up.");

export async function resetEmulators(projectId: string) {
  await fetch(`http://${firestoreHost}/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: "DELETE" });
  await fetch(`http://${authHost}/emulator/v1/projects/${projectId}/accounts`, { method: "DELETE" });
}

export async function setup(overrides: Partial<Config> = {}) {
  const config = loadConfig({ publicBaseUrl: "http://api.test", checkoutEnabled: false, rateLimitOrdersPerMin: 0, rateLimitTrackPerMin: 0, ...overrides });
  if (!config.projectId.startsWith("demo-")) throw new Error("Tests only run against a demo- emulator project.");
  await resetEmulators(config.projectId);
  const store = openStore(config);
  await createAdmin(store, { email: ADMIN_EMAIL, name: "Test Owner", role: "owner", password: ADMIN_PASSWORD });
  const app = createApp({ store, config });
  return { app, store, config };
}

type App = ReturnType<typeof createApp>;

export async function call(app: App, method: string, url: string, init: { body?: unknown; headers?: Record<string, string>; form?: FormData; raw?: string } = {}) {
  const headers: Record<string, string> = { ...init.headers };
  let body: FormData | string | undefined;
  if (init.raw !== undefined) body = init.raw;
  else if (init.form) body = init.form;
  else if (init.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(init.body);
  }
  const response = await app.fetch(new Request(`http://api.test${url}`, { method, headers, body }));
  const type = response.headers.get("content-type") ?? "";
  const data = type.includes("json") ? await response.json() : await response.arrayBuffer();
  return { status: response.status, headers: response.headers, data: data as any };
}

// Signs in through the Auth emulator's REST API, as the Firebase client SDK would.
export async function signIn(email: string, password: string): Promise<{ status: number; token: string }> {
  const response = await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=emulator`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const data = (await response.json()) as { idToken?: string };
  return { status: response.status, token: data.idToken ?? "" };
}

export async function login(app: App, email = ADMIN_EMAIL, password = ADMIN_PASSWORD) {
  const { status, token } = await signIn(email, password);
  if (status !== 200) throw new Error(`sign-in failed: ${status}`);
  const admin = (method: string, url: string, init: { body?: unknown; form?: FormData } = {}) =>
    call(app, method, `/api/admin${url}`, { ...init, headers: { authorization: `Bearer ${token}` } });
  return { token, admin };
}

// Revocation is checked at one-second granularity; wait so earlier tokens are strictly older.
export const nextSecond = () => new Promise((resolve) => setTimeout(resolve, 1100));

// Minimal valid RGB PNG of the given size.
export function png(width = 480, height = 480): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const typed = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(typed) >>> 0);
    return Buffer.concat([length, typed, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const row = Buffer.alloc(1 + width * 3, 0xc8);
  row[0] = 0;
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

export function imageForm(fields: Record<string, string>, data: Buffer = png(), name = "decant.png") {
  const form = new FormData();
  form.set("file", new File([new Uint8Array(data)], name, { type: "image/png" }));
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return form;
}

// Smallest byte strings that pass the content sniffing. They are not playable.
export const mp4 = (extraBytes = 0) =>
  Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom", "ascii"), Buffer.alloc(12 + extraBytes, 1)]);
export const webm = () => Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(32, 2)]);

export function mediaForm(fields: Record<string, string>, data: Buffer, name: string, type: string) {
  const form = new FormData();
  form.set("file", new File([new Uint8Array(data)], name, { type }));
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return form;
}

export const completeProduct = {
  house: "Maison Verité",
  name: "Cèdre Lumière",
  concentration: "Eau de Parfum",
  family: "Woody",
  shortDescription: "Bright cedar over soft musk.",
  description: "A clear, dry cedar composition with a soft musky drydown.",
  notes: { top: ["Bergamot"], heart: ["Cedar"], base: ["Musk"] },
  sourceBrand: "Maison Verité",
  authenticityCopy: "Decanted by hand from an authentic retail bottle.",
  whatArrives: "One 5 ml glass decant with a fine-mist sprayer, labelled and sealed.",
  copyApproved: true,
  physical: { bottleMaterial: "Clear glass", capType: "Black fine-mist sprayer", labelVersion: "v1 cream label", packagingNotes: "" },
};

type Admin = Awaited<ReturnType<typeof login>>["admin"];

// A published product with one 5 ml size, built through the real admin API.
export async function createPublishedProduct(admin: Admin, stock = 5, name = "Cèdre Lumière") {
  const product = await admin("POST", "/products", { body: { house: "Maison Verité", name } });
  const productId = product.data.id as string;
  const photo = await admin("POST", `/products/${productId}/images`, { form: imageForm({ role: "decant-front", alt: "Actual 5 ml Esspor decant, front view", isRealPhoto: "true" }) });
  await admin("PATCH", `/products/${productId}/images/${photo.data.id}`, { body: { approved: true } });
  const variant = await admin("POST", `/products/${productId}/variants`, { body: { sku: `T-${Math.random().toString(36).slice(2, 7)}`, sizeMl: 5, priceMinor: 12000, stockQuantity: stock } });
  await admin("PATCH", `/products/${productId}`, { body: completeProduct });
  const published = await admin("POST", `/products/${productId}/publish`);
  if (published.status !== 200) throw new Error(`could not publish: ${JSON.stringify(published.data)}`);
  return { productId, variantId: variant.data.id as string };
}
