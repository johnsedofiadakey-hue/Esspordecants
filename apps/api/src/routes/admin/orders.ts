import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv, Deps } from "../../context.ts";
import { COLLECTIONS } from "../../firebase.ts";
import { fold, now } from "../../lib/util.ts";
import { longText, readJson } from "../../lib/validate.ts";
import { toCsv } from "../../lib/csv.ts";
import { audit } from "../../services/audit.ts";
import {
  expireUnpaidOrders,
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

const notesBody = z.object({ internalNotes: longText(4000).optional(), publicNote: longText(300).optional() });
const commentBody = z.object({ note: longText(1000).min(1) });

export function orderRoutes(deps: Deps) {
  const { store, config } = deps;
  const orders = store.db.collection(COLLECTIONS.orders);
  const app = new Hono<AppEnv>();

  // What needs doing right now. The admin polls this, so it is two cheap counts.
  // Paid orders are ready to prepare; with payment by phone, unpaid ones need a call.
  app.get("/orders/attention", async (c) => {
    const states = deps.payments.online ? ["paid"] : ["paid", "pending_payment"];
    const query = orders.where("status", "in", states);
    const [count, newest] = await Promise.all([
      query.count().get(),
      query.orderBy("createdAt", "desc").limit(1).get(),
    ]);
    const latest = newest.docs[0]?.data() as OrderDoc | undefined;
    return c.json({ count: count.data().count, newestNumber: latest?.number ?? null, newestAt: latest?.createdAt ?? null });
  });

  app.get("/orders/export", async (c) => {
    const status = c.req.query("status");
    const base = status && (ORDER_STATUSES as readonly string[]).includes(status) ? orders.where("status", "==", status) : orders;
    const docs = (await base.orderBy("createdAt", "desc").limit(5000).get()).docs.map((doc) => doc.data() as OrderDoc);
    const rows = docs
      .filter((order) => !order.isSample)
      .map((order) => [
        order.number,
        order.createdAt,
        order.status,
        order.paymentStatus,
        order.fulfilmentMethod ?? "delivery",
        order.customerName,
        order.customerPhone,
        [order.deliveryAddress?.line1, order.deliveryAddress?.line2, order.deliveryAddress?.city, order.deliveryAddress?.region].filter(Boolean).join(", "),
        order.items.map((item) => `${item.quantity} x ${item.house} ${item.name} ${item.sizeMl}ml`).join("; "),
        (order.subtotalMinor / 100).toFixed(2),
        (order.deliveryMinor / 100).toFixed(2),
        (order.totalMinor / 100).toFixed(2),
        order.deliveryLabel,
        order.publicNote ?? "",
        order.internalNotes,
      ]);
    const header = ["Order", "Placed", "Status", "Payment", "Method", "Customer", "Phone", "Address", "Items", "Subtotal GHS", "Delivery GHS", "Total GHS", "Delivery option", "Customer note", "Internal notes"];
    return c.body(toCsv([header, ...rows]), 200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="esspor-orders-${new Date().toISOString().slice(0, 10)}.csv"`,
    });
  });

  app.get("/orders", async (c) => {
    // Online orders that were never paid release their stock; do it before listing.
    if (deps.payments.online) await expireUnpaidOrders(store, config.unpaidOrderMinutes);
    const status = c.req.query("status");
    const q = fold(c.req.query("q")?.trim() ?? "");
    const base = status && (ORDER_STATUSES as readonly string[]).includes(status) ? orders.where("status", "==", status) : orders;
    const snapshot = await base.orderBy("createdAt", "desc").limit(q ? 1000 : 200).get();
    const items = snapshot.docs
      .map((doc) => ({ id: doc.id, ...(doc.data() as OrderDoc) }))
      .filter((order) => !q || fold(`${order.number} ${order.customerName} ${order.customerEmail} ${order.customerPhone}`).includes(q))
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
    const changes: Record<string, string> = {};
    if (input.internalNotes !== undefined) changes.internalNotes = input.internalNotes;
    if (input.publicNote !== undefined) changes.publicNote = input.publicNote;
    await orders.doc(id).update({ ...changes, updatedAt: now() });
    await audit(store, c.get("user").id, "update", "order", id, { fields: Object.keys(changes) });
    return c.json(orderDetail({ id, ...(await getOrderDoc(store, id)) }));
  });

  return app;
}
