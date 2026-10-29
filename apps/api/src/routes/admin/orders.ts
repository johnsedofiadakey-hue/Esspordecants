import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv, Deps } from "../../context.ts";
import { COLLECTIONS } from "../../firebase.ts";
import { fold, now } from "../../lib/util.ts";
import { longText, readJson } from "../../lib/validate.ts";
import { audit } from "../../services/audit.ts";
import {
  getOrderDoc,
  makeEvent,
  ORDER_STATUSES,
  orderDetail,
  orderSummary,
  transitionOrder,
  type OrderDoc,
} from "../../services/orders.ts";

const statusBody = z.object({
  status: z.enum(ORDER_STATUSES),
  note: longText(1000).optional().default(""),
});

const notesBody = z.object({ internalNotes: longText(4000) });
const commentBody = z.object({ note: longText(1000).min(1) });

export function orderRoutes(deps: Deps) {
  const { store } = deps;
  const orders = store.db.collection(COLLECTIONS.orders);
  const app = new Hono<AppEnv>();

  app.get("/orders", async (c) => {
    const status = c.req.query("status");
    const q = fold(c.req.query("q")?.trim() ?? "");
    const base = status && (ORDER_STATUSES as readonly string[]).includes(status) ? orders.where("status", "==", status) : orders;
    const snapshot = await base.orderBy("createdAt", "desc").limit(q ? 1000 : 200).get();
    const items = snapshot.docs
      .map((doc) => ({ id: doc.id, ...(doc.data() as OrderDoc) }))
      .filter((order) => !q || fold(`${order.number} ${order.customerName} ${order.customerEmail}`).includes(q))
      .slice(0, 200);
    return c.json({ items: items.map(orderSummary), statuses: ORDER_STATUSES });
  });

  app.get("/orders/:id", async (c) => {
    const id = c.req.param("id");
    return c.json(orderDetail({ id, ...(await getOrderDoc(store, id)) }));
  });

  app.post("/orders/:id/status", async (c) => {
    const id = c.req.param("id");
    const input = await readJson(c, statusBody);
    const user = c.get("user");
    const order = await transitionOrder(store, id, input.status, input.note, { id: user.id, name: user.name });
    await audit(store, user.id, "status", "order", id, { to: input.status });
    return c.json(orderDetail(order));
  });

  app.post("/orders/:id/notes", async (c) => {
    const id = c.req.param("id");
    const input = await readJson(c, commentBody);
    const user = c.get("user");
    const order = await store.db.runTransaction(async (tx) => {
      const order = await getOrderDoc(store, id, tx);
      order.events.push(makeEvent("note", { note: input.note, actor: { id: user.id, name: user.name } }));
      order.updatedAt = now();
      tx.set(orders.doc(id), order);
      return order;
    });
    return c.json(orderDetail({ id, ...order }));
  });

  app.patch("/orders/:id", async (c) => {
    const id = c.req.param("id");
    const input = await readJson(c, notesBody);
    await getOrderDoc(store, id);
    await orders.doc(id).update({ internalNotes: input.internalNotes, updatedAt: now() });
    await audit(store, c.get("user").id, "update", "order", id, { fields: ["internalNotes"] });
    return c.json(orderDetail({ id, ...(await getOrderDoc(store, id)) }));
  });

  return app;
}
