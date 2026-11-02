import type { Config } from "./config.ts";
import type { Store } from "./firebase.ts";
import type { PaymentAdapter } from "./services/payments.ts";

export type AdminUser = {
  id: string;
  email: string;
  name: string;
  role: "owner" | "editor";
};

export type Shell = { html: string; headers: Record<string, string> };

export type Deps = {
  store: Store;
  config: Config;
  payments: PaymentAdapter;
  // Returns the storefront's index.html (and its security headers), which product link previews are built from.
  fetchShell: () => Promise<Shell>;
};

export type AppEnv = {
  Variables: {
    user: AdminUser;
  };
};
