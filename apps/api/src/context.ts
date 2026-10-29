import type { Config } from "./config.ts";
import type { Store } from "./firebase.ts";
import type { PaymentAdapter } from "./services/payments.ts";

export type AdminUser = {
  id: string;
  email: string;
  name: string;
  role: "owner" | "editor";
};

export type Deps = {
  store: Store;
  config: Config;
  payments: PaymentAdapter;
};

export type AppEnv = {
  Variables: {
    user: AdminUser;
  };
};
