import { Hono } from "hono";
import type { AppEnv, Deps, Shell } from "../context.ts";
import { listPublicProductsCached } from "../services/catalog.ts";
import { listPublicProducts, publicSummary } from "../services/products.ts";

const esc = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const trim = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value);

type Page = { title: string; description: string; url: string; image?: string; noindex?: boolean; jsonLd?: unknown };

// Chat apps and search engines read a page's tags without running its JavaScript, so a
// shared product link would otherwise show the same generic card as the home page. These
// routes serve the storefront's own page with product-specific tags added.
function withMeta(shell: string, page: Page): string {
  const tags = [
    `<link rel="canonical" href="${esc(page.url)}" />`,
    `<meta name="description" content="${esc(page.description)}" />`,
    `<meta property="og:type" content="${page.jsonLd ? "product" : "website"}" />`,
    `<meta property="og:site_name" content="Esspor Decants" />`,
    `<meta property="og:title" content="${esc(page.title)}" />`,
    `<meta property="og:description" content="${esc(page.description)}" />`,
    `<meta property="og:url" content="${esc(page.url)}" />`,
    page.image ? `<meta property="og:image" content="${esc(page.image)}" />` : "",
    `<meta name="twitter:card" content="${page.image ? "summary_large_image" : "summary"}" />`,
    page.noindex ? `<meta name="robots" content="noindex" />` : "",
    page.jsonLd ? `<script type="application/ld+json">${JSON.stringify(page.jsonLd).replace(/</g, "\\u003c")}</script>` : "",
  ].filter(Boolean);
  return shell
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(page.title)}</title>`)
    .replace(/<meta\s+name="description"[^>]*>\s*/, "")
    .replace(/<meta\s+property="og:[^>]*>\s*/g, "")
    .replace(/<link\s+rel="canonical"[^>]*>\s*/, "")
    .replace("</head>", `${tags.join("\n    ")}\n  </head>`);
}

export function seoRoutes(deps: Deps) {
  const { store, config } = deps;
  const app = new Hono<AppEnv>();

  let shell: { at: number; value: Shell } | null = null;
  async function getShell(): Promise<Shell | null> {
    if (shell && Date.now() - shell.at < 5 * 60_000) return shell.value;
    try {
      const value = await deps.fetchShell();
      shell = { at: Date.now(), value };
      return value;
    } catch (error) {
      console.error("Could not load the storefront page", error);
      return shell?.value ?? null;
    }
  }

  app.get("/product/:slug", async (c) => {
    const slug = decodeURIComponent(c.req.param("slug"));
    const base = await getShell();
    if (!base) return c.text("The page is loading. Please try again in a moment.", 503, { "Retry-After": "10" });
    const product = (await listPublicProductsCached(store, config.catalogCacheMs, listPublicProducts)).find((entry) => entry.slug === slug);
    const url = `${config.siteUrl}/product/${encodeURIComponent(slug)}`;
    if (!product) {
      return c.html(withMeta(base.html, { title: "Fragrance not found | Esspor Decants", description: "This fragrance is not available.", url, noindex: true }), 404, {
        ...base.headers,
        "Cache-Control": "public, max-age=0, s-maxage=60",
      });
    }
    const summary = publicSummary(config.publicBaseUrl, product);
    const sizes = product.variants.filter((variant) => variant.active && variant.priceMinor > 0).map((variant) => variant.sizeMl);
    const description = trim(summary.shortDescription || product.description || `${summary.name} by ${summary.house}, as an Esspor decant.`, 200);
    const page: Page = {
      title: `${summary.name} by ${summary.house} · decant from GH₵${(summary.minPriceMinor / 100).toFixed(2)} | Esspor Decants`,
      description,
      url,
      image: summary.heroImage.url,
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "Product",
        name: `${summary.name} (decant)`,
        brand: { "@type": "Brand", name: summary.house },
        description,
        image: summary.heroImage.url,
        offers: {
          "@type": "AggregateOffer",
          priceCurrency: "GHS",
          lowPrice: (summary.minPriceMinor / 100).toFixed(2),
          offerCount: sizes.length,
          availability: summary.available ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
        },
      },
    };
    return c.html(withMeta(base.html, page), 200, { ...base.headers, "Cache-Control": "public, max-age=0, s-maxage=300" });
  });

  app.get("/sitemap.xml", async (c) => {
    const products = await listPublicProductsCached(store, config.catalogCacheMs, listPublicProducts);
    const fixed = ["/", "/shop", "/how-it-works", "/about", "/privacy", "/terms", "/delivery-returns", "/contact"];
    const entry = (path: string, lastmod?: string | null) =>
      `  <url><loc>${esc(config.siteUrl + path)}</loc>${lastmod ? `<lastmod>${esc(lastmod.slice(0, 10))}</lastmod>` : ""}</url>`;
    const body = [...fixed.map((path) => entry(path)), ...products.map((product) => entry(`/product/${encodeURIComponent(product.slug)}`, product.updatedAt))].join("\n");
    return c.body(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`, 200, {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=3600",
    });
  });

  app.get("/robots.txt", (c) =>
    c.text(`User-agent: *\nAllow: /\nDisallow: /bag\nDisallow: /track\nDisallow: /api/\nSitemap: ${config.siteUrl}/sitemap.xml\n`, 200, {
      "Cache-Control": "public, max-age=300, s-maxage=3600",
    }),
  );

  return app;
}
