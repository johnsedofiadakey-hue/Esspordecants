# Claude Code assignment: Esspor backend and admin

The user approved splitting work: Codex builds the public front end and UI; Claude owns the backend, admin portal, product uploads, orders, CMS, and related services. Work only in `apps/admin`, `apps/api`, and shared backend files you create. Do not edit `apps/storefront` or `mockups`; coordinate field or route changes through `docs/SHARED_CONTRACT.md`.

Read `mockups/CONCEPT.md`, `docs/SHARED_CONTRACT.md`, and inspect the mockup images. Esspor sells authentic designer and niche **decants**, not full-size fragrance bottles. The brand guide is available in the user-provided Drive folder linked from the concept; local brand assets used by the storefront will be under its public directory. Keep source-bottle images distinct from what the buyer receives.

Build a local backend and admin portal with a durable local database, secure admin authentication, product and size-variant CRUD, image role/alt text and upload workflow, draft/published workflow, editorial content, order management, and public JSON endpoints matching the shared contract. Make public reads published-only. Price and stock must be server authoritative. Add useful validation for required product facts and publish gates. Use synthetic local sample data for development, with no real products published by default. Document setup, data model, API routes, admin usage, and integration commands.

The storefront is a Vite app running on localhost:5173 or the next available port. Its default API base URL is `http://localhost:4000`, so allow the local storefront origin through development CORS. Variant images should match the physical bottle for that size. The public product API should provide the actual decant as its first image and label original source-bottle photos distinctly.

Payment provider, delivery policy, actual bottle, size list, real products, and production hosting are unconfirmed. Keep checkout/payment in a clearly isolated adapter or pending state; do not initialize live charges or deploy. Do not print or commit secrets. Ask for user input on decisions you cannot safely infer, and keep independent implementation moving.

When finished, write `docs/CLAUDE_REPORT.md` in this shared workspace. Include:

- What was implemented, with the main files and any unfinished work.
- Exact local setup and run commands for the API and admin portal, including required environment variable names (never their values).
- The implemented public routes, response shapes, and any differences from `docs/SHARED_CONTRACT.md`. Record proposed contract changes there before the storefront is adapted.
- How to sign in to the local admin, add a draft product, upload each image role, publish it, and inspect an order using synthetic data.
- Verification performed, with command results and any remaining blockers.
- Specific storefront integration steps needed from Codex.

Avoid modifications to storefront UI or concept images. The user will run Claude separately from the workspace root; this handoff does not require Claude authentication inside Codex.
