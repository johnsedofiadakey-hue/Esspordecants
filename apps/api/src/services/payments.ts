// Payment is deliberately isolated behind this adapter. No provider has been chosen,
// so the only implementation records the order as awaiting payment and charges nothing.
// A real provider (e.g. mobile money or card) should implement PaymentAdapter, verify
// webhooks server-side, and only then move orders to "paid".

export type PaymentInitiation = {
  provider: string;
  status: "pending" | "not_configured";
  reference: string | null;
  message: string;
};

export interface PaymentAdapter {
  readonly name: string;
  initiate(order: { id: string; number: string; totalMinor: number; currency: string }): PaymentInitiation;
}

export const pendingPaymentAdapter: PaymentAdapter = {
  name: "none",
  initiate() {
    return {
      provider: "none",
      status: "not_configured",
      reference: null,
      message: "Payment collection is not configured. Esspor will contact you to arrange payment.",
    };
  },
};
