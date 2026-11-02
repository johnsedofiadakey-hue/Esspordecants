import { COLLECTIONS, type Store } from "../firebase.ts";
import { now, phoneKey } from "../lib/util.ts";

// Contact details and the top banner, editable by the owner without a deploy.
export type SiteSettings = {
  businessName: string;
  announcement: string;
  whatsapp: string;
  phone: string;
  email: string;
  instagram: string;
  pickupNote: string;
  updatedAt: string | null;
};

export const DEFAULT_SITE: SiteSettings = {
  businessName: "Esspor Decants",
  announcement: "Order before 8PM for next-day delivery | Mon–Fri",
  whatsapp: "",
  phone: "",
  email: "",
  instagram: "",
  pickupNote: "",
  updatedAt: null,
};

const ref = (store: Store) => store.db.collection(COLLECTIONS.settings).doc("site");

// Read often (every page load asks for it) and changed rarely, so keep it briefly in memory.
const cache = new WeakMap<Store, { at: number; value: Promise<SiteSettings> }>();
const TTL_MS = 60_000;

export function getSiteSettings(store: Store): Promise<SiteSettings> {
  const hit = cache.get(store);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const value = ref(store)
    .get()
    .then((snapshot) => ({ ...DEFAULT_SITE, ...((snapshot.data() as Partial<SiteSettings> | undefined) ?? {}) }));
  const entry = { at: Date.now(), value };
  cache.set(store, entry);
  value.catch(() => {
    if (cache.get(store) === entry) cache.delete(store);
  });
  return value;
}

export async function saveSiteSettings(store: Store, input: Omit<SiteSettings, "updatedAt">): Promise<SiteSettings> {
  const next: SiteSettings = {
    ...input,
    // Stored in international form so links work for any way it was typed.
    whatsapp: input.whatsapp ? phoneKey(input.whatsapp) : "",
    phone: input.phone.trim(),
    instagram: input.instagram.trim().replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/^@/, "").replace(/\/+$/, ""),
    updatedAt: now(),
  };
  await ref(store).set(next);
  cache.delete(store);
  return next;
}
