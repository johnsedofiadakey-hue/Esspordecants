export type BagItem = {
  variantId: string;
  productId: string;
  productSlug: string;
  house: string;
  name: string;
  sizeMl: number;
  priceMinor: number;
  imageUrl: string;
  quantity: number;
};

const key = "esspor-bag-v1";
const eventName = "esspor-bag-change";

export function readBag(): BagItem[] {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function writeBag(items: BagItem[]) {
  localStorage.setItem(key, JSON.stringify(items));
  window.dispatchEvent(new Event(eventName));
}

export function addToBag(item: BagItem) {
  const items = readBag();
  const existing = items.find((entry) => entry.variantId === item.variantId);
  if (existing) existing.quantity += item.quantity;
  else items.push(item);
  writeBag(items);
}

export function setBagQuantity(variantId: string, quantity: number) {
  writeBag(
    readBag()
      .map((item) =>
        item.variantId === variantId ? { ...item, quantity } : item,
      )
      .filter((item) => item.quantity > 0),
  );
}

// Order numbers are the customer's only way to check an order, so the last few are
// remembered in this browser too. Nothing else about the order is stored.
const ordersKey = "esspor-orders-v1";

export function readOrders(): { number: string; at: string }[] {
  try {
    const value = JSON.parse(localStorage.getItem(ordersKey) || "[]");
    return Array.isArray(value) ? value.filter((entry) => typeof entry?.number === "string").slice(0, 5) : [];
  } catch {
    return [];
  }
}

export function rememberOrder(number: string) {
  try {
    const rest = readOrders().filter((entry) => entry.number !== number);
    localStorage.setItem(ordersKey, JSON.stringify([{ number, at: new Date().toISOString() }, ...rest].slice(0, 5)));
  } catch {
    // Private browsing: the screenshot is the fallback.
  }
}

export function clearBag() {
  writeBag([]);
}

export function subscribeBag(callback: () => void) {
  window.addEventListener(eventName, callback);
  return () => window.removeEventListener(eventName, callback);
}
