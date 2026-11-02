import { randomInt } from "node:crypto";
import { FieldValue, type Transaction } from "firebase-admin/firestore";
import type { Config } from "../config.ts";
import { COLLECTIONS, type Store } from "../firebase.ts";
import { ApiError, notFound } from "../lib/errors.ts";
import { newId, now, phoneKey } from "../lib/util.ts";
import { invalidateCatalog } from "./catalog.ts";
import type { PaymentAdapter, PaymentInitiation } from "./payments.ts";
import { finalize, type Product, type ProductDoc } from "./products.ts";
import { activeDeliveryOptions, mergeLines, priceQuote, productsForVariants, type FulfilmentMethod, type QuoteInput } from "./quote.ts";

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

// All a buyer gives us: who they are, how to reach them, and (for delivery) where.
export type Customer = {
  name: string;
  phone: string;
  address?: string | undefined;
};

// Older orders kept a structured address and an email; newer ones keep only line1.
export type DeliveryAddress = { line1?: string; line2?: string; city?: string; region?: string; notes?: string };

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
  // Every payment attempt gets its own reference; any of them may be the one that succeeds.
  paymentReferences?: string[];
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  // Phone in international digits, for recognising repeat buyers.
  customerPhoneKey?: string;
  fulfilmentMethod?: FulfilmentMethod;
  deliveryAddress: DeliveryAddress;
  deliveryOptionCode: string | null;
  deliveryLabel: string;
  subtotalMinor: number;
  deliveryMinor: number;
  totalMinor: number;
  currency: "GHS";
  internalNotes: string;
  // Shown to the customer on Track order (rider details, pickup time, and so on).
  publicNote?: string;
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

// No I, L, O, 0 or 1, so a number read off a screenshot cannot be mistyped.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

// The running number keeps orders easy to find in the admin. The random suffix makes
// the whole number unguessable, which matters because it is all a customer needs to
// look up an order. 31^4 is about 920,000 combinations per running number.
export async function nextOrderNumber(store: Store, tx: Transaction): Promise<{ number: string; apply: () => void }> {
  const ref = store.db.collection(COLLECTIONS.counters).doc("orders");
  const snapshot = await tx.get(ref);
  const value = ((snapshot.data()?.value as number | undefined) ?? 999) + 1;
  const code = Array.from({ length: 4 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
  return { number: `ESS-${value}-${code}`, apply: () => tx.set(ref, { value }) };
}

// Accepts what a person would type from a screenshot: any case, spaces or underscores for hyphens.
export const normalizeOrderNumber = (input: string) => input.trim().toUpperCase().replace(/[\s_]+/g, "-");

export const SYSTEM_ACTOR = { id: "system", name: "Esspor system" } as const;

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

export async function placeOrder(store: Store, payments: PaymentAdapter, config: Config, input: QuoteInput & { customer: Customer }) {
  // Free stock held by abandoned online payments before this order looks for it.
  if (payments.online) {
    await expireUnpaidOrders(store, config.unpaidOrderMinutes);
    // Each unpaid online order holds stock, so one phone number can only hold a few at once.
    const pending = await orders(store)
      .where("customerPhoneKey", "==", phoneKey(input.customer.phone))
      .where("status", "==", "pending_payment")
      .limit(config.maxPendingOrdersPerPhone)
      .get();
    if (pending.size >= config.maxPendingOrdersPerPhone) {
      throw new ApiError(429, "too_many_pending", "You already have unpaid orders. Pay for one of them, or wait for them to expire, before placing another.");
    }
  }
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
    const method: FulfilmentMethod = option?.method ?? "delivery";
    const address = input.customer.address?.trim() ?? "";
    if (method === "delivery" && address.length < 5) {
      throw new ApiError(422, "address_required", "Add your delivery address.", { field: "address" });
    }

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
      paymentStatus: "pending",
      paymentProvider: payments.name,
      paymentReference: null,
      paymentReferences: [],
      customerName: input.customer.name,
      customerEmail: "",
      customerPhone: input.customer.phone,
      customerPhoneKey: phoneKey(input.customer.phone),
      fulfilmentMethod: method,
      deliveryAddress: method === "delivery" ? { line1: address } : {},
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
      events: [makeEvent("created", { to: "pending_payment", note: payments.online ? "Order placed. Waiting for payment." : "Order placed. Payment to be arranged by phone." })],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    tx.set(orders(store).doc(id), order);
    return { order };
  });
  invalidateCatalog(store);
  // The payment provider is called after the order is saved, never inside the
  // transaction (which can retry). If it fails the order stays and can be paid later.
  const payment = await startPayment(store, payments, config, id);
  return { order: { id, ...result.order }, payment };
}

export async function startPayment(store: Store, payments: PaymentAdapter, config: Config, orderId: string): Promise<PaymentInitiation> {
  const order = await getOrderDoc(store, orderId);
  const payment = await payments.initialize({
    id: orderId,
    number: order.number,
    totalMinor: order.totalMinor,
    currency: order.currency,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    callbackUrl: `${config.siteUrl}/track?number=${encodeURIComponent(order.number)}`,
  });
  const update: Record<string, unknown> = {
    paymentProvider: payment.provider,
    paymentStatus: payment.status === "failed" ? "initiation_failed" : payment.status === "not_configured" ? "not_configured" : "pending",
    updatedAt: now(),
    events: FieldValue.arrayUnion(makeEvent("payment", { note: payment.status === "pending" ? "Payment started with Paystack." : payment.message })),
  };
  if (payment.reference) {
    update.paymentReference = payment.reference;
    update.paymentReferences = FieldValue.arrayUnion(payment.reference);
  }
  await orders(store).doc(orderId).update(update);
  return payment;
}

// Marks an order paid once a provider confirms a successful charge. Safe to call twice
// (the webhook and the customer returning both do), and it never trusts the amount.
export async function applyPaymentSuccess(
  store: Store,
  charge: { reference: string; amountMinor: number; currency: string },
): Promise<"paid" | "ignored" | "needs_review" | "mismatch"> {
  const found = await orders(store).where("paymentReferences", "array-contains", charge.reference).limit(1).get();
  const doc = found.docs[0];
  if (!doc) return "ignored";
  const order = doc.data() as OrderDoc;
  if (order.status !== "pending_payment") {
    if (order.status === "cancelled" || order.status === "refunded") {
      if (order.paymentStatus === "paid_needs_review") return "needs_review";
      await orders(store).doc(doc.id).update({
        paymentStatus: "paid_needs_review",
        updatedAt: now(),
        events: FieldValue.arrayUnion(
          makeEvent("payment", { note: "A payment arrived after this order was cancelled. Refund it in Paystack or contact the customer.", actor: SYSTEM_ACTOR }),
        ),
      });
      return "needs_review";
    }
    return "ignored";
  }
  if (charge.amountMinor !== order.totalMinor || charge.currency !== order.currency) {
    await orders(store).doc(doc.id).update({
      paymentStatus: "amount_mismatch",
      updatedAt: now(),
      events: FieldValue.arrayUnion(
        makeEvent("payment", { note: `Paystack reported ${charge.amountMinor} ${charge.currency} for an order of ${order.totalMinor} ${order.currency}. Not marked paid.`, actor: SYSTEM_ACTOR }),
      ),
    });
    return "mismatch";
  }
  try {
    await transitionOrder(store, doc.id, "paid", `Paid online (${charge.reference}).`, { id: "paystack", name: "Paystack" });
    return "paid";
  } catch (error) {
    // Someone moved it first (for example the webhook and the return page raced).
    if (error instanceof ApiError && error.code === "invalid_transition") return "ignored";
    throw error;
  }
}

// Cancels online orders whose payment never completed, which puts their stock back.
export async function expireUnpaidOrders(store: Store, olderThanMinutes: number, limit = 20) {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60_000).toISOString();
  const stale = await orders(store).where("status", "==", "pending_payment").where("createdAt", "<", cutoff).limit(limit).get();
  for (const doc of stale.docs) {
    if ((doc.data() as OrderDoc).isSample) continue;
    try {
      await transitionOrder(store, doc.id, "cancelled", "Payment was not completed in time.", SYSTEM_ACTOR);
    } catch {
      // Paid or changed in the meantime; nothing to do.
    }
  }
}

export async function getOrderDoc(store: Store, id: string, tx?: Transaction): Promise<OrderDoc> {
  const ref = orders(store).doc(id);
  const snapshot = tx ? await tx.get(ref) : await ref.get();
  if (!snapshot.exists) throw notFound("Order");
  return snapshot.data() as OrderDoc;
}

export async function transitionOrder(store: Store, orderId: string, to: OrderStatus, note: string, actor: NonNullable<Actor>) {
  const updated = await store.db.runTransaction(async (tx) => {
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
  invalidateCatalog(store);
  return updated;
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
    paymentReferences: order.paymentReferences ?? [],
    customerPhone: order.customerPhone,
    fulfilmentMethod: order.fulfilmentMethod ?? "delivery",
    deliveryAddress: order.deliveryAddress,
    deliveryOptionCode: order.deliveryOptionCode,
    deliveryLabel: order.deliveryLabel,
    subtotalMinor: order.subtotalMinor,
    deliveryMinor: order.deliveryMinor,
    internalNotes: order.internalNotes,
    publicNote: order.publicNote ?? "",
    allowedTransitions: ORDER_TRANSITIONS[order.status],
    items: order.items,
    events: order.events.map(({ actorUserId: _actor, ...event }) => event),
  };
}

export { recordStock };


// ---------- What a customer may see ----------

export type Stage = { label: string; detail: string };

export function customerStage(order: Pick<OrderDoc, "status" | "paymentStatus" | "fulfilmentMethod">, online: boolean): Stage {
  const pickup = order.fulfilmentMethod === "pickup";
  switch (order.status) {
    case "pending_payment":
      return online
        ? { label: "Waiting for payment", detail: "Your items are reserved while you pay. Unpaid orders are released after a short while." }
        : { label: "Order received", detail: "Esspor will contact you to arrange payment." };
    case "paid":
      return { label: "Payment received", detail: "Thank you. We'll start preparing your decants." };
    case "processing":
      return { label: "Preparing your order", detail: "Your decants are being filled and labelled." };
    case "shipped":
      return pickup
        ? { label: "Ready for pickup", detail: "Your order is ready to collect." }
        : { label: "On its way", detail: "Your order has left us and is on its way to you." };
    case "delivered":
      return pickup ? { label: "Collected", detail: "Enjoy your decants." } : { label: "Delivered", detail: "Enjoy your decants." };
    case "cancelled":
      return order.paymentStatus === "paid_needs_review"
        ? { label: "Cancelled", detail: "Your payment arrived after the order was cancelled. Please contact Esspor and quote your order number for a refund." }
        : { label: "Cancelled", detail: "This order was cancelled." };
    case "refunded":
      return { label: "Refunded", detail: "This order has been refunded." };
  }
}

// Deliberately leaves out the name, phone, address, internal notes and who did what.
export function publicOrder(order: OrderDoc & { id: string }, online: boolean) {
  const stageOf = (status: OrderStatus) => customerStage({ ...order, status }, online).label;
  return {
    number: order.number,
    status: order.status,
    stage: customerStage(order, online),
    fulfilmentMethod: order.fulfilmentMethod ?? "delivery",
    deliveryLabel: order.deliveryLabel,
    items: order.items.map(({ house, name, sizeMl, quantity }) => ({ house, name, sizeMl, quantity })),
    subtotalMinor: order.subtotalMinor,
    deliveryMinor: order.deliveryMinor,
    totalMinor: order.totalMinor,
    currency: order.currency,
    paymentStatus: order.paymentStatus,
    note: order.publicNote ?? "",
    canPay: online && order.status === "pending_payment",
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    timeline: order.events
      .filter((event) => event.type === "created" || (event.type === "status" && event.to))
      .map((event) => ({
        label: event.type === "created" ? "Order placed" : stageOf(event.to as OrderStatus),
        at: event.createdAt,
      })),
  };
}
