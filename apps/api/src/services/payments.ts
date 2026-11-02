import { createHmac, timingSafeEqual } from "node:crypto";
import type { Config } from "../config.ts";

// Payment sits behind this interface so the rest of the API never knows which
// provider is in use. With no key configured the "none" adapter records the order
// as awaiting payment and charges nothing (Esspor then arranges payment by phone).

export type PaymentInitiation = {
  provider: string;
  status: "pending" | "not_configured" | "failed";
  reference: string | null;
  // Where to send the customer to pay. Null when payment is arranged by phone.
  authorizationUrl: string | null;
  message: string;
};

export type PaymentCheck = { status: "success" | "pending" | "failed"; amountMinor: number; currency: string };

export type PaymentRequest = {
  id: string;
  number: string;
  totalMinor: number;
  currency: string;
  customerName: string;
  customerPhone: string;
  callbackUrl: string;
};

export interface PaymentAdapter {
  readonly name: string;
  // True when real payments are taken online (orders then wait for a confirmed payment).
  readonly online: boolean;
  initialize(request: PaymentRequest): Promise<PaymentInitiation>;
  verify(reference: string): Promise<PaymentCheck>;
  verifyWebhook(rawBody: string, signature: string | undefined): boolean;
}

export const pendingPaymentAdapter: PaymentAdapter = {
  name: "none",
  online: false,
  async initialize() {
    return {
      provider: "none",
      status: "not_configured",
      reference: null,
      authorizationUrl: null,
      message: "Payment collection is not configured. Esspor will contact you to arrange payment.",
    };
  },
  async verify() {
    return { status: "pending", amountMinor: 0, currency: "GHS" };
  },
  verifyWebhook() {
    return false;
  },
};

type PaystackConfig = Pick<Config, "paystackSecretKey" | "paystackBaseUrl" | "paymentEmailDomain">;

const digits = (value: string) => value.replace(/\D/g, "");

// Paystack hosted checkout (card and mobile money). Amounts are sent in pesewas, the
// minor unit of GHS, which is also how the API stores prices.
export function paystackAdapter(config: PaystackConfig, fetchImpl: typeof fetch = fetch): PaymentAdapter {
  const secret = config.paystackSecretKey;
  if (!secret) throw new Error("PAYSTACK_SECRET_KEY is not set.");
  const call = async (path: string, init?: RequestInit) => {
    const response = await fetchImpl(`${config.paystackBaseUrl}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await response.json().catch(() => ({}))) as { status?: boolean; message?: string; data?: any };
    if (!response.ok || body.status === false) throw new Error(`Paystack ${response.status}: ${body.message ?? "request failed"}`);
    return body.data;
  };

  return {
    name: "paystack",
    online: true,
    async initialize(request) {
      // Each attempt gets its own reference, so a retry can never be mistaken for the first try.
      const reference = `${request.number}-${Math.random().toString(36).slice(2, 8)}`;
      try {
        const data = await call("/transaction/initialize", {
          method: "POST",
          body: JSON.stringify({
            // Paystack requires an email, but checkout does not ask for one. This
            // placeholder is built from the phone number; turn off Paystack's
            // customer emails in its dashboard so nothing is sent to it.
            email: `${digits(request.customerPhone) || "customer"}@${config.paymentEmailDomain}`,
            amount: request.totalMinor,
            currency: request.currency,
            reference,
            callback_url: request.callbackUrl,
            metadata: {
              orderId: request.id,
              orderNumber: request.number,
              custom_fields: [
                { display_name: "Order", variable_name: "order_number", value: request.number },
                { display_name: "Customer", variable_name: "customer_name", value: request.customerName },
                { display_name: "Phone", variable_name: "customer_phone", value: request.customerPhone },
              ],
            },
          }),
        });
        if (!data?.authorization_url) throw new Error("Paystack returned no payment link.");
        return {
          provider: "paystack",
          status: "pending",
          reference: String(data.reference ?? reference),
          authorizationUrl: String(data.authorization_url),
          message: "Continue to Paystack to pay.",
        };
      } catch (error) {
        console.error("Paystack initialize failed", error);
        return {
          provider: "paystack",
          status: "failed",
          reference: null,
          authorizationUrl: null,
          message: "We couldn't start the payment. Your order is saved; open it from Track order and tap Pay now.",
        };
      }
    },
    async verify(reference) {
      const data = await call(`/transaction/verify/${encodeURIComponent(reference)}`);
      const status = data?.status === "success" ? "success" : data?.status === "failed" || data?.status === "abandoned" ? "failed" : "pending";
      return { status, amountMinor: Number(data?.amount ?? 0), currency: String(data?.currency ?? "") };
    },
    verifyWebhook(rawBody, signature) {
      if (!signature) return false;
      const expected = createHmac("sha512", secret).update(rawBody).digest("hex");
      const given = Buffer.from(signature, "utf8");
      const wanted = Buffer.from(expected, "utf8");
      return given.length === wanted.length && timingSafeEqual(given, wanted);
    },
  };
}

export function paymentAdapterFor(config: PaystackConfig): PaymentAdapter {
  return config.paystackSecretKey ? paystackAdapter(config) : pendingPaymentAdapter;
}
