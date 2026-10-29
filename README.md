# Esspor Decants website

The public storefront is in `apps/storefront`. Claude's backend and admin assignment is defined in `docs/CLAUDE_HANDOFF.md`; the integration boundary is `docs/SHARED_CONTRACT.md`. The visual review images are in `mockups`.

## Run the storefront locally

```sh
cd apps/storefront
npm install
npm run dev
```

The app reads `VITE_API_BASE_URL` (see `.env.example`) and expects the public routes in `docs/SHARED_CONTRACT.md`. Until the API serves published products, the shop shows a clear preparation state. `/preview/product` displays a synthetic layout example with purchase disabled. The local bag is browser storage; final prices and availability must be quoted by the backend before checkout.

## Current boundaries

The homepage uses clearly labelled generated concept imagery. Replace it with approved photos of the real decant bottle before launch. The reference mockup's 2, 5 and 10 ml sizes are illustrative; actual sizes, bottle design, first products, prices, payment provider, delivery rules, and production hosting remain to be confirmed. No live payment or production deployment has occurred.
