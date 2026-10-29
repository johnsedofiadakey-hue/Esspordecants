import { defineConfig } from "vite";

// In development the admin reaches the local API through this proxy, matching the
// same-origin /api rewrite that Firebase Hosting provides in production.
const apiTarget = process.env.ADMIN_API_PROXY_TARGET ?? "http://127.0.0.1:4000";

export default defineConfig({
  server: {
    host: "127.0.0.1",
    port: 5180,
    strictPort: true,
    proxy: { "/api": { target: apiTarget, changeOrigin: false } },
  },
  preview: {
    host: "127.0.0.1",
    port: 5181,
    strictPort: true,
    proxy: { "/api": { target: apiTarget, changeOrigin: false } },
  },
});
