import type { Transaction } from "firebase-admin/firestore";
import { COLLECTIONS, type Store } from "../firebase.ts";
import { ApiError, notFound } from "../lib/errors.ts";
import { newId, now } from "../lib/util.ts";
import type { PaymentAdapter } from "./payments.ts";
import { finalize, type Product, type ProductDoc } from "./products.ts";
import { activeDeliveryOptions, mergeLines, priceQuote, productsForVariants, type QuoteInput } from "./quote.ts";

export const ORDER_STATUSES = [
  "pending_payment",
  "paid",
  "processing",
  "shipped",
  "delivered",
  "cancelled",
  "refunded",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending_payment: ["paid", "cancelled"],
  paid: ["processing", "cancelled", "refunded"],
  processing: ["shipped", "cancelled", "refunded"],
  shipped: ["delivered"],
  delivered: ["refunded"],
  cancelled: [],
  refunded: [],
};

// Stock goes back on the shelf only if the goods never left.
const RESTOCK_FROM: ReadonlySet<OrderStatus> = new Set(["pending_payment", "paid", "processing"]);

export type Customer = {
  name: string;
  email: string;
  phone: string;
  address: { line1: string; line2?: string | undefined; city: string; region: string; notes?: string | undefined };
};

export type OrderItem = {
  id: string;
  variantId: string;
  productId: string;
  sku: string;
  house: string;
  name: string;
  sizeMl: number;
  unitPriceMinor: number;
  quantity: number;
  lineTotalMinor: number;
};

export type OrderEvent = {
  id: string;
  type: string;
  from: string | null;
  to: string | null;
  note: string;
  actorUserId: string | null;
  actorName: string | null;
  createdAt: string;
};

export type OrderDoc = {
  number: string;
  status: OrderStatus;
  paymentStatus: string;
  paymentProvider: string;
  paymentReference: string | null;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  deliveryAddress: Customer["address"] | Record<string, never>;
  deliveryOptionCode: string | null;
  deliveryLabel: string;
  subtotalMinor: number;
  deliveryMinor: number;
  totalMinor: number;
  currency: "GHS";
  internalNotes: string;
  isSample: boolean;
  items: OrderItem[];
  // Indexed copies of the item ids, so products and sizes that were ordered can't be deleted.
  productIds: string[];
  variantIds: string[];
  events: OrderEvent[];
  createdAt: string;
  updatedAt: string;
};

export type Actor = { id: string; name: string } | null;

const orders = (store: Store) => store.db.collection(COLLECTIONS.orders);

export function makeEvent(
  type: string,
  input: { from?: string | null; to?: string | null; note?: string; actor?: Actor; at?: string },
): OrderEvent {
  return {
    id: newId(),
    type,
    from: input.from ?? null,
    to: input.to ?? null,
    note: input.note ?? "",
    actorUserId: input.actor?.id ?? null,
    actorName: input.actor?.name ?? null,
    createdAt: input.at ?? now(),
  };
}

export async function nextOrderNumber(store: Store, tx: Transaction): Promise<{ number: string; apply: () => void }> {
  const ref = store.db.collection(COLLECTIONS.counters).doc("orders");
  const snapshot = await tx.get(ref);
  const value = ((snapshot.data()?.value as number | undefined) ?? 999) + 1;
  return { number: `ESS-${value}`, apply: () => tx.set(ref, { value }) };
}

function recordStock(
  store: Store,
  tx: Transaction,
  entry: { variantId: string; productId: string; delta: number; reason: string; orderId: string | null; actorUserId: string | null },
) {
  tx.set(store.db.collection(COLLECTIONS.stock).doc(), { ...entry, createdAt: now() });
}

// Changes a variant's stock on an in-memory product. Throws if it would go negative.
export function applyStock(product: ProductDoc, variantId: string, delta: number) {
  const variant = product.variants.find((entry) => entry.id === variantId);
  if (!variant) throw notFound("Variant");
  if (variant.stockQuantity + delta < 0) {
    throw new ApiError(409, "insufficient_stock", `Stock cannot go below zero (currently ${variant.stockQuantity}).`);
  }
  variant.stockQuantity += delta;
}

export async function placeOrder(store: Store, payments: PaymentAdapter, input: QuoteInput & { customer: Customer }) {
  const id = newId();
  const result = await store.db.runTransaction(async (tx) => {
    // Firestore transactions must do every read before the first write.
    const ids = [...mergeLines(input.items).keys()];
    const owners = await productsForVariants(store, ids, tx);
    const delivery = await activeDeliveryOptions(store, tx);
    const counter = await nextOrderNumber(store, tx);

    const quote = priceQuote(input, owners, delivery, true);
    if (quote.items.length === 0) throw new ApiError(422, "empty_order", "Your bag is empty.");
    if (quote.errors.length > 0) {
      throw new ApiError(409, "quote_changed", "Some items changed. Review your bag and try again.", { quote });
    }
    if (quote.deliveryOptions.length > 0 && !quote.selectedDeliveryOptionCode) {
      throw new ApiError(422, "delivery_required", "Choose a delivery option.", { quote });
    }
    const option = quote.deliveryOptions.find((entry) => entry.code === quote.selectedDeliveryOptionCode);
    const payment = payments.initiate({ id, number: counter.number, totalMinor: quote.totalMinor, currency: quote.currency });

    const touched = new Map<string, Product>();
    for (const line of quote.items) {
      const product = touched.get(line.productId) ?? owners.get(line.variantId)!;
      applyStock(product, line.variantId, -line.quantity);
      touched.set(product.id, product);
    }
    for (const product of touched.values()) {
      const { id: productId, ...doc } = product;
      tx.set(store.db.collection(COLLECTIONS.products).doc(productId), { ...finalize(doc), updatedAt: now() });
    }
    for (const line of quote.items) {
      recordStock(store, tx, { variantId: line.variantId, productId: line.productId, delta: -line.quantity, reason: "order_placed", orderId: id, actorUserId: null });
    }
    counter.apply();

    const timestamp = now();
    const order: OrderDoc = {
      number: counter.number,
      status: "pending_payment",
      paymentStatus: payment.status,
      paymentProvider: payment.provider,
      paymentReference: payment.reference,
      customerName: input.customer.name,
      customerEmail: input.customer.email.toLowerCase(),
      customerPhone: input.customer.phone,
      deliveryAddress: input.customer.address,
      deliveryOptionCode: option?.code ?? null,
      deliveryLabel: option?.label ?? "",
      subtotalMinor: quote.subtotalMinor,
      deliveryMinor: quote.deliveryMinor,
      totalMinor: quote.totalMinor,
      currency: "GHS",
      internalNotes: "",
      isSample: false,
      items: quote.items.map((line) => ({
        id: newId(),
        variantId: line.variantId,
        productId: line.productId,
        sku: line.sku,
        house: line.house,
        name: line.name,
        sizeMl: line.sizeMl,
        unitPriceMinor: line.unitPriceMinor,
        quantity: line.quantity,
        lineTotalMinor: line.lineTotalMinor,
      })),
      productIds: [...new Set(quote.items.map((line) => line.productId))],
      variantIds: quote.items.map((line) => line.variantId),
      events: [makeEvent("created", { to: "pending_payment", note: payment.message })],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    tx.set(orders(store).doc(id), order);
    return { order, payment };
  });
  return { order: { id, ...result.order }, payment: result.payment };
}

export async function getOrderDoc(store: Store, id: string, tx?: Transaction): Promise<OrderDoc> {
  const ref = orders(store).doc(id);
  const snapshot = tx ? await tx.get(ref) : await ref.get();
  if (!snapshot.exists) throw notFound("Order");
  return snapshot.data() as OrderDoc;
}

export async function transitionOrder(store: Store, orderId: string, to: OrderStatus, note: string, actor: NonNullable<Actor>) {
  return store.db.runTransaction(async (tx) => {
    const order = await getOrderDoc(store, orderId, tx);
    if (!ORDER_TRANSITIONS[order.status].includes(to)) {
      throw new ApiError(409, "invalid_transition", `An order that is ${order.status.replace("_", " ")} cannot move to ${to.replace("_", " ")}.`);
    }
    const restock = (to === "cancelled" || to === "refunded") && RESTOCK_FROM.has(order.status) && !order.isSample;
    // Reads first: load every product that needs stock returned.
    const owners = restock ? await productsForVariants(store, order.items.map((item) => item.variantId), tx) : new Map<string, Product>();

    if (restock) {
      const touched = new Map<string, Product>();
      for (const item of order.items) {
        const product = touched.get(item.productId) ?? owners.get(item.variantId);
        if (!product) continue; // variant was deleted since; nothing to restock
        applyStock(product, item.variantId, item.quantity);
        touched.set(product.id, product);
        recordStock(store, tx, { variantId: item.variantId, productId: product.id, delta: item.quantity, reason: `order_${to}`, orderId, actorUserId: actor.id });
      }
      for (const product of touched.values()) {
        const { id: productId, ...doc } = product;
        tx.set(store.db.collection(COLLECTIONS.products).doc(productId), { ...finalize(doc), updatedAt: now() });
      }
    }

    order.paymentStatus = to === "paid" ? "paid" : to === "refunded" ? "refunded" : order.paymentStatus;
    order.events.push(makeEvent("status", { from: order.status, to, note, actor }));
    order.status = to;
    order.updatedAt = now();
    tx.set(orders(store).doc(orderId), order);
    return { id: orderId, ...order };
  });
}

export function orderSummary(order: OrderDoc & { id: string }) {
  return {
    id: order.id,
    number: order.number,
    status: order.status,
    paymentStatus: order.paymentStatus,
    customerName: order.customerName,
    customerEmail: order.customerEmail,
    totalMinor: order.totalMinor,
    currency: order.currency,
    isSample: order.isSample,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

export function orderDetail(order: OrderDoc & { id: string }) {
  return {
    ...orderSummary(order),
    paymentProvider: order.paymentProvider,
    paymentReference: order.paymentReference,
    customerPhone: order.customerPhone,
    deliveryAddress: order.deliveryAddress,
    deliveryOptionCode: order.deliveryOptionCode,
    deliveryLabel: order.deliveryLabel,
    subtotalMinor: order.subtotalMinor,
    deliveryMinor: order.deliveryMinor,
    internalNotes: order.internalNotes,
    allowedTransitions: ORDER_TRANSITIONS[order.status],
    items: order.items,
    events: order.events.map(({ actorUserId: _actor, ...event }) => event),
  };
}

export { recordStock };
