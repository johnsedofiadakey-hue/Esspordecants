# Esspor storefront concept — review draft

## Visual direction

The [Pinterest reference](https://www.pinterest.com/pin/1132022056368773334/) uses a cinematic bottle hero, warm orange glow, dark surroundings, minimal navigation, and large editorial type. This concept translates that mood to Esspor's own brand: cream `#FFF5E8`, burnt orange `#D26411`, peach `#FDCA97`, coffee `#47291C`, Overlock type, the supplied Esspor logo, and a restrained use of the supplied pattern. The brand presentation defines Esspor as an authentic designer and niche fragrance decant business. The principal product shown is therefore a travel-size decant rather than a full-size perfume bottle.

## Review images

- [Desktop homepage](esspor-home-desktop.png)
- [Phone homepage](esspor-home-mobile.png)
- [Product detail](esspor-product-detail-desktop.png)

The hero and bottle renders are generated concept images. They do not depict an approved production bottle, label, cap, fill level, packaging, or a specific fragrance. The product name, sizes (2/5/10 ml), price, stock, and category content are layout placeholders. Real product photography and approved catalogue data should replace them before launch.

## Product presentation to agree before implementation

The product page should clearly distinguish the original fragrance from the Esspor decant. The gallery should use actual photos of the decant front, side, cap and sprayer, source bottle, and packaging. Show the precise decant size selected and update image, price, SKU, and availability with that selection. Provide fragrance house/name, concentration, scent family, top/heart/base notes when verified, a concise description, contents and packaging, and authenticity/source information. Any claims such as longevity or performance should come from approved product copy.

## Division of work

Codex: public storefront front end and UI, including responsive home, catalogue, search/filter presentation, product detail, bag/checkout UI, accessibility, and the integration layer to the admin services.

Claude: admin portal, product uploads, catalogue/CMS data, variant prices and stock, order management, checkout/payment and fulfilment services, and the published API/content contract. The shared contract should define product IDs/slugs, published status, currency, variant sizes, images with roles/alt text, stock and price fields, editorial content, order/checkout responses, and error states before implementation starts.

## Needed before live product listings

1. Photos or specifications for the actual decant bottle, cap/sprayer, label, and packaging, plus approved fragrance photos where permitted.
2. Confirmed size options and the first real products, prices, and market/currency.
3. Claude's implementation of the shared API and CMS contract in `../docs/SHARED_CONTRACT.md`.

The visual direction was approved and the public storefront implementation has started. See `../README.md` for the current local state. Images in this folder remain concept and review artifacts.
