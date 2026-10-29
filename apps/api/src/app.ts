import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { requireAdmin } from "./auth/middleware.ts";
import type { Config } from "./config.ts";
import type { AppEnv, Deps } from "./context.ts";
import type { Store } from "./firebase.ts";
import { ApiError } from "./lib/errors.ts";
import { contentRoutes } from "./routes/admin/content.ts";
import { orderRoutes } from "./routes/admin/orders.ts";
import { productRoutes } from "./routes/admin/products.ts";
import { settingsRoutes } from "./routes/admin/settings.ts";
import { userRoutes } from "./routes/admin/users.ts";
import { publicRoutes } from "./routes/public.ts";
import { pendingPaymentAdapter, type PaymentAdapter } from "./services/payments.ts";

const localOrigin = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\]):\d{2,5}$/;

export function createApp(input: { store: Store; config: Config; payments?: PaymentAdapter }) {
  const deps: Deps = { store: input.store, config: input.config, payments: input.payments ?? pendingPaymentAdapter };
  const { config } = deps;
  const app = new Hono<AppEnv>();

  app.use("*", secureHeaders({ crossOriginResourcePolicy: false }));

  // In production the storefront and admin call the API on their own origin through
  // Firebase Hosting rewrites. CORS covers local development and any extra origins.
  app.use(
    "/api/v1/*",
    cors({
      origin: (origin) => {
        if (config.storefrontOrigins.includes(origin)) return origin;
        if (!config.isProduction && localOrigin.test(origin)) return origin;
        return null;
      },
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Content-Type", "Accept"],
      maxAge: 600,
    }),
  );

  const jsonLimit = bodyLimit({
    maxSize: 256 * 1024,
    onError: () => {
      throw new ApiError(413, "payload_too_large", "Request body is too large.");
    },
  });
  const uploadLimit = bodyLimit({
    maxSize: config.maxUploadBytes + 64 * 1024,
    onError: () => {
      throw new ApiError(413, "file_too_large", "Images must be under 8 MB.");
    },
  });
  app.use("/api/v1/*", jsonLimit);
  app.use("/api/admin/*", async (c, next) => {
    const isUpload = c.req.method === "POST" && /\/images$/.test(c.req.path);
    return isUpload ? uploadLimit(c, next) : jsonLimit(c, next);
  });

  app.route("/", publicRoutes(deps));

  const admin = new Hono<AppEnv>();
  admin.use("*", requireAdmin(deps));
  admin.use("*", async (c, next) => {
    await next();
    c.header("Cache-Control", "no-store");
  });
  admin.route("/", userRoutes(deps));
  admin.route("/", productRoutes(deps));
  admin.route("/", contentRoutes(deps));
  admin.route("/", orderRoutes(deps));
  admin.route("/", settingsRoutes(deps));
  app.route("/api/admin", admin);

  app.notFound((c) => c.json({ error: { code: "not_found", message: "Route not found." } }, 404));

  app.onError((error, c) => {
    if (error instanceof ApiError) {
      return c.json(
        { error: { code: error.code, message: error.message, ...(error.details !== undefined ? { details: error.details } : {}) } },
        error.status,
      );
    }
    console.error(error);
    return c.json({ error: { code: "internal_error", message: "Something went wrong." } }, 500);
  });

  return app;
}
