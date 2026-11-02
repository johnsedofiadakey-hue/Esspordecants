import type { Store } from "../firebase.ts";
import type { Product } from "./products.ts";

// The public catalogue is small, so each list, search and family request scans every
// published product. Holding the result briefly means a burst of requests (or a bot
// varying the query string to dodge the CDN) costs one scan, not one per request.
// Writes made through this process clear it; other instances catch up within the TTL.
const cache = new WeakMap<Store, { at: number; items: Promise<Product[]> }>();

export function listPublicProductsCached(store: Store, ttlMs: number, load: (store: Store) => Promise<Product[]>): Promise<Product[]> {
  if (ttlMs <= 0) return load(store);
  const hit = cache.get(store);
  if (hit && Date.now() - hit.at < ttlMs) return hit.items;
  const items = load(store);
  const entry = { at: Date.now(), items };
  cache.set(store, entry);
  items.catch(() => {
    if (cache.get(store) === entry) cache.delete(store);
  });
  return items;
}

export function invalidateCatalog(store: Store) {
  cache.delete(store);
}
