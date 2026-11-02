export type Config = {
  port: number;
  host: string;
  isProduction: boolean;
  projectId: string;
  publicBaseUrl: string;
  storefrontOrigins: string[];
  mediaBucket: string;
  checkoutEnabled: boolean;
  maxUploadBytes: number;
  // Videos pass through the function, which accepts requests up to 32 MiB. The caps
  // below are deliberately small: every byte served is billed as egress.
  maxVideoBytes: number;
  maxPhotosPerProduct: number;
  maxVideosPerProduct: number;
  // How long the published catalogue is held in memory between Firestore scans.
  catalogCacheMs: number;
  // Paystack. With no key, orders are taken but payment is arranged by phone.
  paystackSecretKey: string | null;
  paystackBaseUrl: string;
  // The storefront's public address, used for the page Paystack sends customers back to.
  siteUrl: string;
  // Paystack insists on an email; this is the domain of the placeholder built from the phone number.
  paymentEmailDomain: string;
  // Unpaid online orders release their reserved stock after this long.
  unpaidOrderMinutes: number;
  // Requests per minute per client (0 turns the limit off).
  rateLimitOrdersPerMin: number;
  rateLimitTrackPerMin: number;
  // Cloudflare Turnstile. With no secret the challenge is off (the honeypot and limits stay on).
  turnstileSecretKey: string | null;
  turnstileVerifyUrl: string;
  // An online buyer may have this many unpaid orders at once (stops stock hoarding).
  maxPendingOrdersPerPhone: number;
};

// A secret that is empty, or the word "off", means the feature is switched off.
export function secretOrNull(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" || trimmed.toLowerCase() === "off" ? null : trimmed;
}

function flag(value: string | undefined): boolean {
  return value === "true" || value === "1";
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const env = process.env;
  const port = Number(env.PORT ?? 4000);
  const storefrontOrigins = (env.STOREFRONT_ORIGINS ?? "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  return {
    port,
    host: env.HOST ?? "127.0.0.1",
    // K_SERVICE is set by Cloud Functions (2nd gen) / Cloud Run.
    isProduction: env.NODE_ENV === "production" || Boolean(env.K_SERVICE),
    projectId: env.GCLOUD_PROJECT ?? env.GOOGLE_CLOUD_PROJECT ?? "demo-esspor",
    publicBaseUrl: (env.PUBLIC_BASE_URL ?? `http://localhost:${port}`).replace(/\/$/, ""),
    storefrontOrigins,
    mediaBucket: env.MEDIA_BUCKET ?? "esspordecants-media",
    checkoutEnabled: flag(env.CHECKOUT_ENABLED),
    maxUploadBytes: 5 * 1024 * 1024,
    maxVideoBytes: 20 * 1024 * 1024,
    maxPhotosPerProduct: 16,
    maxVideosPerProduct: 4,
    catalogCacheMs: 30_000,
    paystackSecretKey: secretOrNull(env.PAYSTACK_SECRET_KEY),
    paystackBaseUrl: (env.PAYSTACK_BASE_URL ?? "https://api.paystack.co").replace(/\/$/, ""),
    siteUrl: (env.SITE_URL ?? storefrontOrigins[0] ?? "http://localhost:5173").replace(/\/$/, ""),
    paymentEmailDomain: env.PAYMENT_EMAIL_DOMAIN ?? "customers.esspordecants.web.app",
    unpaidOrderMinutes: Number(env.UNPAID_ORDER_MINUTES ?? 45),
    rateLimitOrdersPerMin: 10,
    rateLimitTrackPerMin: 40,
    turnstileSecretKey: secretOrNull(env.TURNSTILE_SECRET_KEY),
    turnstileVerifyUrl: env.TURNSTILE_VERIFY_URL ?? "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    maxPendingOrdersPerPhone: 3,
    ...overrides,
  };
}
