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
};

function flag(value: string | undefined): boolean {
  return value === "true" || value === "1";
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const env = process.env;
  const port = Number(env.PORT ?? 4000);
  return {
    port,
    host: env.HOST ?? "127.0.0.1",
    // K_SERVICE is set by Cloud Functions (2nd gen) / Cloud Run.
    isProduction: env.NODE_ENV === "production" || Boolean(env.K_SERVICE),
    projectId: env.GCLOUD_PROJECT ?? env.GOOGLE_CLOUD_PROJECT ?? "demo-esspor",
    publicBaseUrl: (env.PUBLIC_BASE_URL ?? `http://localhost:${port}`).replace(/\/$/, ""),
    storefrontOrigins: (env.STOREFRONT_ORIGINS ?? "http://localhost:5173")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    mediaBucket: env.MEDIA_BUCKET ?? "esspordecants-media",
    checkoutEnabled: flag(env.CHECKOUT_ENABLED),
    maxUploadBytes: 8 * 1024 * 1024,
    ...overrides,
  };
}
