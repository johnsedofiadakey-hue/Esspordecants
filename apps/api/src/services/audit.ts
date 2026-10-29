import type { Store } from "../firebase.ts";
import { COLLECTIONS } from "../firebase.ts";
import { now } from "../lib/util.ts";

export async function audit(
  store: Store,
  userId: string | null,
  action: string,
  entity: string,
  entityId: string | null,
  detail: Record<string, unknown> = {},
) {
  await store.db.collection(COLLECTIONS.audit).add({ userId, action, entity, entityId, detail, createdAt: now() });
}
