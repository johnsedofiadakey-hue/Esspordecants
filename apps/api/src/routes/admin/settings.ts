import type { Query } from "firebase-admin/firestore";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv, Deps } from "../../context.ts";
import { requireOwner } from "../../auth/middleware.ts";
import { COLLECTIONS } from "../../firebase.ts";
import { conflict, notFound } from "../../lib/errors.ts";
import { now } from "../../lib/util.ts";
import { longText, readJson, shortText } from "../../lib/validate.ts";
import { audit } from "../../services/audit.ts";
import { stockStatus, type ProductDoc } from "../../services/products.ts";
import type { DeliveryDoc } from "../../services/quote.ts";

const deliveryFields = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9-]+$/),
  label: shortText(80).min(2),
  description: longText(500),
  priceMinor: z.number().int().min(0).max(10_000_000),
  active: z.boolean(),
  sortOrder: z.number().int().min(0).max(1000),
});

const toDelivery = (id: string, doc: DeliveryDoc) => ({
  id,
  code: doc.code,
  label: doc.label,
  description: doc.description,
  priceMinor: doc.priceMinor,
  active: doc.active,
  sortOrder: doc.sortOrder,
});

export function settingsRoutes(deps: Deps) {
  const { store, config } = deps;
  const delivery = store.db.collection(COLLECTIONS.delivery);
  const app = new Hono<AppEnv>();

  app.get("/summary", async (c) => {
    const products = store.db.collection(COLLECTIONS.products);
    const orders = store.db.collection(COLLECTIONS.orders);
    const count = async (query: Query) => (await query.count().get()).data().count;
    const [draft, published, archived, open, total, deliveryActive, live] = await Promise.all([
      count(products.where("status", "==", "draft")),
      count(products.where("status", "==", "published")),
      count(products.where("status", "==", "archived")),
      count(orders.where("status", "in", ["pending_payment", "paid", "processing"])),
      count(orders),
      count(delivery.where("active", "==", true)),
      products.where("status", "==", "published").get(),
    ]);
    const lowStock = live.docs
      .flatMap((doc) => {
        const product = doc.data() as ProductDoc;
        return product.variants
          .filter((variant) => variant.active && stockStatus(variant) !== "in_stock")
          .map((variant) => ({
            variantId: variant.id,
            productId: doc.id,
            label: `${product.house} ${product.name} · ${variant.sizeMl} ml`,
            sku: variant.sku,
            stockQuantity: variant.stockQuantity,
            stockStatus: stockStatus(variant),
          }));
      })
      .sort((a, b) => a.stockQuantity - b.stockQuantity)
      .slice(0, 50);
    return c.json({
      products: { draft, published, archived },
      orders: { open, total },
      lowStock,
      checkoutEnabled: config.checkoutEnabled,
      deliveryOptionsActive: deliveryActive,
      paymentProvider: deps.payments.name,
    });
  });

  app.get("/delivery-options", async (c) => {
    const items = (await delivery.get()).docs
      .map((doc) => toDelivery(doc.id, doc.data() as DeliveryDoc))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label));
    return c.json({ items });
  });

  app.post("/delivery-options", requireOwner(), async (c) => {
    const input = await readJson(c, deliveryFields.partial({ description: true, active: true, sortOrder: true }));
    // The code is the document id, which makes it unique.
    const ref = delivery.doc(input.code);
    const doc: DeliveryDoc = {
      code: input.code,
      label: input.label,
      description: input.description ?? "",
      priceMinor: input.priceMinor,
      active: input.active ?? false,
      sortOrder: input.sortOrder ?? 0,
      createdAt: now(),
      updatedAt: now(),
    };
    try {
      await ref.create(doc);
    } catch {
      throw conflict("code_taken", "That code is already in use.");
    }
    await audit(store, c.get("user").id, "create", "delivery_option", ref.id, { code: input.code });
    return c.json(toDelivery(ref.id, doc), 201);
  });

  app.patch("/delivery-options/:id", requireOwner(), async (c) => {
    const id = c.req.param("id");
    const input = await readJson(c, deliveryFields.omit({ code: true }).partial());
    const snapshot = await delivery.doc(id).get();
    if (!snapshot.exists) throw notFound("Delivery option");
    const doc = { ...(snapshot.data() as DeliveryDoc), ...Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)), updatedAt: now() } as DeliveryDoc;
    await delivery.doc(id).set(doc);
    await audit(store, c.get("user").id, "update", "delivery_option", id, { fields: Object.keys(input) });
    return c.json(toDelivery(id, doc));
  });

  app.delete("/delivery-options/:id", requireOwner(), async (c) => {
    const id = c.req.param("id");
    const snapshot = await delivery.doc(id).get();
    if (!snapshot.exists) throw notFound("Delivery option");
    await delivery.doc(id).delete();
    await audit(store, c.get("user").id, "delete", "delivery_option", id);
    return c.json({ ok: true });
  });

  app.get("/audit", requireOwner(), async (c) => {
    const [entries, admins] = await Promise.all([
      store.db.collection(COLLECTIONS.audit).orderBy("createdAt", "desc").limit(200).get(),
      store.db.collection(COLLECTIONS.admins).get(),
    ]);
    const names = new Map(admins.docs.map((doc) => [doc.id, doc.data().name as string]));
    const items = entries.docs.map((doc) => {
      const row = doc.data();
      return { action: row.action, entity: row.entity, entityId: row.entityId, detail: row.detail, createdAt: row.createdAt, actor: row.userId ? (names.get(row.userId) ?? null) : null };
    });
    return c.json({ items });
  });

  return app;
}
