import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  formatMoney,
  getFacets,
  listProducts,
  type Audience,
  type Facets,
  type ProductFilters,
  type ProductSummary,
} from "./api";

// Presentational pieces for browsing and choosing a fragrance. They know nothing about the
// bag or the page chrome, so the home, shop and product pages can all share them.

export const AUDIENCE_LABEL: Record<Exclude<Audience, "">, string> = { women: "For her", men: "For him", unisex: "For anyone" };
export const cap = (value: string) => value.replace(/(^|[\s-])(\w)/g, (_, space, letter) => space + letter.toUpperCase());

// ---------- Product card ----------

function badgeFor(product: ProductSummary): { text: string; tone: string } | null {
  if (!product.available) return { text: "Sold out", tone: "out" };
  const live = product.sizes.filter((size) => size.available);
  if (live.length && !live.some((size) => size.stockStatus === "in_stock")) return { text: "Few left", tone: "few" };
  if (product.isNew) return { text: "New", tone: "new" };
  return null;
}

export function ProductCard({ product }: { product: ProductSummary }) {
  const badge = badgeFor(product);
  return (
    <a href={`/product/${encodeURIComponent(product.slug)}`} className={`pcard ${product.available ? "" : "pcard--out"}`}>
      <div className="pcard__media">
        {badge ? <span className={`pcard__badge pcard__badge--${badge.tone}`}>{badge.text}</span> : null}
        <img className="pcard__img" src={product.heroImage.url} alt={product.heroImage.alt} loading="lazy" decoding="async" />
        {product.altImage ? <img className="pcard__img pcard__img--alt" src={product.altImage.url} alt="" loading="lazy" decoding="async" /> : null}
        {product.audience ? <span className="pcard__audience">{AUDIENCE_LABEL[product.audience]}</span> : null}
      </div>
      <div className="pcard__body">
        <span className="pcard__house">{product.house}</span>
        <h3>{product.name}</h3>
        <p className="pcard__tags">{[product.family, ...product.accords.filter((accord) => accord.toLowerCase() !== product.family.toLowerCase()).slice(0, 2).map(cap)].filter(Boolean).join(" · ")}</p>
        {product.sizes.length ? (
          <ul className="pcard__sizes" aria-label="Sizes">
            {product.sizes.map((size) => (
              <li key={size.sizeMl} className={size.available ? "" : "off"}>
                {size.sizeMl} ml
              </li>
            ))}
          </ul>
        ) : null}
        <p className="pcard__price">{product.available ? <>From <strong>{formatMoney(product.minPriceMinor)}</strong></> : <span>Currently unavailable</span>}</p>
      </div>
    </a>
  );
}

// A row of cards that scrolls sideways on a phone and sits as a grid on a desktop.
export function ProductShelf({ eyebrow, title, href, linkText = "Shop all", products, id }: { eyebrow: string; title: string; href?: string; linkText?: string; products: ProductSummary[]; id: string }) {
  if (!products.length) return null;
  return (
    <section className="shelf section-pad" aria-labelledby={id}>
      <div className="section-heading" data-reveal>
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h2 id={id}>{title}</h2>
        </div>
        {href ? (
          <a className="text-link" href={href}>
            {linkText} <span aria-hidden="true">→</span>
          </a>
        ) : null}
      </div>
      <div className="shelf__row">
        {products.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>
    </section>
  );
}

// ---------- Scent display ----------

export function Meter({ label, value, labels }: { label: string; value: number; labels: string[] }) {
  if (!value) return null;
  return (
    <div className="meter">
      <span className="meter__label">{label}</span>
      <span className="meter__dots" role="img" aria-label={`${label}: ${labels[value - 1]}, ${value} out of 5`}>
        {[1, 2, 3, 4, 5].map((n) => (
          <i key={n} className={n <= value ? "on" : ""} />
        ))}
      </span>
      <span className="meter__text">{labels[value - 1]}</span>
    </div>
  );
}

export const LONGEVITY = ["Soft", "Moderate", "Long-lasting", "Very long-lasting", "Beast mode"];
export const PROJECTION = ["Close to skin", "Gentle", "Noticeable", "Strong", "Fills the room"];

export function NotesPyramid({ notes }: { notes: { top: string[]; heart: string[]; base: string[] } }) {
  const tiers: [string, string, string[]][] = [
    ["Top", "First impression", notes.top],
    ["Heart", "The character", notes.heart],
    ["Base", "What lingers", notes.base],
  ];
  if (!tiers.some(([, , list]) => list.length)) return null;
  return (
    <div className="pyramid">
      {tiers.map(([name, hint, list]) =>
        list.length ? (
          <div key={name} className="pyramid__tier">
            <div>
              <strong>{name}</strong>
              <small>{hint}</small>
            </div>
            <ul>
              {list.map((note) => (
                <li key={note}>{cap(note)}</li>
              ))}
            </ul>
          </div>
        ) : null,
      )}
    </div>
  );
}

// ---------- Shop filters, kept in the web address so a search can be shared ----------

export type ShopFilters = {
  query: string;
  family: string;
  audience: string;
  accord: string;
  house: string;
  size: string;
  price: string;
  sort: string;
};

const FILTER_KEYS: (keyof ShopFilters)[] = ["query", "family", "audience", "accord", "house", "size", "price", "sort"];

function readFilters(): ShopFilters {
  const params = new URLSearchParams(window.location.search);
  return Object.fromEntries(FILTER_KEYS.map((key) => [key, params.get(key) || (key === "sort" ? "newest" : "")])) as ShopFilters;
}

export const PRICE_BANDS: { value: string; label: string; min: number; max: number }[] = [
  { value: "u60", label: "Under GH₵60", min: 0, max: 6000 },
  { value: "60-100", label: "GH₵60 – 100", min: 6000, max: 10000 },
  { value: "100-200", label: "GH₵100 – 200", min: 10000, max: 20000 },
  { value: "200+", label: "GH₵200 and up", min: 20000, max: 0 },
];

export function toApiFilters(filters: ShopFilters): ProductFilters {
  const band = PRICE_BANDS.find((entry) => entry.value === filters.price);
  return {
    query: filters.query,
    family: filters.family,
    audience: filters.audience,
    accord: filters.accord,
    house: filters.house,
    size: Number(filters.size) || undefined,
    minPrice: band?.min || undefined,
    maxPrice: band?.max || undefined,
    sort: (filters.sort as ProductFilters["sort"]) || "newest",
  };
}

export function useShopFilters(): [ShopFilters, (patch: Partial<ShopFilters>) => void, () => void] {
  const [filters, setFilters] = useState(readFilters);
  useEffect(() => {
    const onPop = () => setFilters(readFilters());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const write = (next: ShopFilters) => {
    const params = new URLSearchParams();
    for (const key of FILTER_KEYS) if (next[key] && !(key === "sort" && next[key] === "newest")) params.set(key, next[key]);
    window.history.pushState(null, "", params.size ? `/shop?${params}` : "/shop");
    setFilters(next);
  };
  return [filters, (patch) => write({ ...filters, ...patch }), () => write({ ...readFilters(), query: "", family: "", audience: "", accord: "", house: "", size: "", price: "" })];
}

export function useFacets(): Facets | null {
  const [facets, setFacets] = useState<Facets | null>(null);
  useEffect(() => {
    let active = true;
    getFacets()
      .then((value) => active && setFacets(value))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  return facets;
}

const fold = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// The product list for the current filters, fetched a page at a time.
export function useShopProducts(filters: ShopFilters) {
  const [state, setState] = useState<{ loading: boolean; more: boolean; error: boolean; products: ProductSummary[]; total: number; page: number }>({
    loading: true, more: false, error: false, products: [], total: 0, page: 1,
  });
  const key = JSON.stringify(filters);
  const request = useRef(0);
  const load = (page: number) => {
    const ticket = ++request.current;
    setState((current) => ({ ...current, loading: page === 1, more: page > 1, error: false }));
    listProducts({ ...toApiFilters(filters), page, pageSize: 24 })
      .then((result) => {
        if (ticket !== request.current) return;
        setState((current) => ({
          loading: false, more: false, error: false, page,
          products: page === 1 ? result.items : [...current.products, ...result.items],
          total: result.total,
        }));
      })
      .catch(() => ticket === request.current && setState((current) => ({ ...current, loading: false, more: false, error: true })));
  };
  useEffect(() => load(1), [key]);
  return { ...state, loadMore: () => load(state.page + 1) };
}

// A labelled group of tap choices in the filter panel.
function FilterGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="fgroup">
      <legend>{title}</legend>
      <div className="fgroup__options">{children}</div>
    </fieldset>
  );
}

function Option({ on, onClick, children, count }: { on: boolean; onClick: () => void; children: ReactNode; count?: number }) {
  return (
    <button type="button" className={`fopt ${on ? "on" : ""}`} aria-pressed={on} onClick={onClick}>
      {children}
      {count !== undefined ? <small>{count}</small> : null}
    </button>
  );
}

export function FilterPanel({ facets, filters, set }: { facets: Facets | null; filters: ShopFilters; set: (patch: Partial<ShopFilters>) => void }) {
  const toggle = (key: keyof ShopFilters, value: string) => set({ [key]: filters[key] === value ? "" : value } as Partial<ShopFilters>);
  const selected = (key: keyof ShopFilters, value: string) => fold(filters[key]) === fold(value);
  const bands = PRICE_BANDS.filter((band) => !facets?.price || (facets.price.maxMinor >= band.min && (!band.max || facets.price.minMinor <= band.max)));
  // A choice that arrived in a link stays visible even if it is not in the list.
  const withSelected = (list: { name: string; count: number }[], value: string) => (value && !list.some((entry) => fold(entry.name) === fold(value)) ? [...list, { name: value, count: 0 }] : list);
  return (
    <div className="filters-panel">
      {facets && facets.families.length ? (
        <FilterGroup title="Scent family">
          {withSelected(facets.families, filters.family).map((entry) => (
            <Option key={entry.name} on={selected("family", entry.name)} onClick={() => toggle("family", entry.name)} count={entry.count}>
              {entry.name}
            </Option>
          ))}
        </FilterGroup>
      ) : null}
      {facets && facets.audiences.length ? (
        <FilterGroup title="Who it's for">
          {["women", "men", "unisex"].map((name) => (
            <Option key={name} on={selected("audience", name)} onClick={() => toggle("audience", name)}>
              {AUDIENCE_LABEL[name as keyof typeof AUDIENCE_LABEL]}
            </Option>
          ))}
        </FilterGroup>
      ) : null}
      {facets && facets.accords.length ? (
        <FilterGroup title="Flavours">
          {withSelected(facets.accords.slice(0, 14), filters.accord).map((entry) => (
            <Option key={entry.name} on={selected("accord", entry.name)} onClick={() => toggle("accord", entry.name)}>
              {cap(entry.name)}
            </Option>
          ))}
        </FilterGroup>
      ) : null}
      {facets && facets.sizes.length ? (
        <FilterGroup title="Bottle size">
          {facets.sizes.map((entry) => (
            <Option key={entry.sizeMl} on={filters.size === String(entry.sizeMl)} onClick={() => toggle("size", String(entry.sizeMl))}>
              {entry.sizeMl} ml
            </Option>
          ))}
        </FilterGroup>
      ) : null}
      {bands.length > 1 ? (
        <FilterGroup title="Price">
          {bands.map((band) => (
            <Option key={band.value} on={filters.price === band.value} onClick={() => toggle("price", band.value)}>
              {band.label}
            </Option>
          ))}
        </FilterGroup>
      ) : null}
      {facets && facets.houses.length > 1 ? (
        <FilterGroup title="House">
          {withSelected(facets.houses, filters.house).map((entry) => (
            <Option key={entry.name} on={selected("house", entry.name)} onClick={() => toggle("house", entry.name)} count={entry.count}>
              {entry.name}
            </Option>
          ))}
        </FilterGroup>
      ) : null}
    </div>
  );
}

// The choices currently applied, each removable with one tap.
export function ActiveFilters({ filters, set, clear }: { filters: ShopFilters; set: (patch: Partial<ShopFilters>) => void; clear: () => void }) {
  const items: [keyof ShopFilters, string][] = [];
  if (filters.query) items.push(["query", `“${filters.query}”`]);
  if (filters.family) items.push(["family", filters.family]);
  if (filters.audience) items.push(["audience", AUDIENCE_LABEL[filters.audience as keyof typeof AUDIENCE_LABEL] ?? filters.audience]);
  if (filters.accord) items.push(["accord", cap(filters.accord)]);
  if (filters.size) items.push(["size", `${filters.size} ml`]);
  if (filters.price) items.push(["price", PRICE_BANDS.find((band) => band.value === filters.price)?.label ?? filters.price]);
  if (filters.house) items.push(["house", filters.house]);
  if (!items.length) return null;
  return (
    <div className="active-filters">
      {items.map(([key, label]) => (
        <button key={key} type="button" className="active-filter" onClick={() => set({ [key]: "" } as Partial<ShopFilters>)} aria-label={`Remove filter ${label}`}>
          {label} <span aria-hidden="true">×</span>
        </button>
      ))}
      <button type="button" className="text-link" onClick={clear}>
        Clear all
      </button>
    </div>
  );
}

// ---------- Small shared bits ----------

export function Faq({ items }: { items: { q: string; a: ReactNode }[] }) {
  return (
    <div className="faq">
      {items.map((item) => (
        <details key={item.q}>
          <summary>{item.q}</summary>
          <div>{item.a}</div>
        </details>
      ))}
    </div>
  );
}

const ICONS: Record<string, ReactNode> = {
  shield: <path d="M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6zM8.5 12l2.5 2.5L16 9.5" />,
  drop: <path d="M12 3c3.5 4.2 6 7.2 6 10.5A6 6 0 0 1 6 13.5C6 10.2 8.5 7.2 12 3z" />,
  lock: <path d="M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3" />,
  pin: <path d="M12 21s7-5.6 7-11a7 7 0 0 0-14 0c0 5.4 7 11 7 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z" />,
  truck: <path d="M2 6h11v10H2zM13 9h4l3 3v4h-7zM6 19a1.7 1.7 0 1 0 0-3.4 1.7 1.7 0 0 0 0 3.4zM17 19a1.7 1.7 0 1 0 0-3.4 1.7 1.7 0 0 0 0 3.4z" />,
  chat: <path d="M4 5h16v11H9l-5 4zM8 9.5h8M8 12.5h5" />,
};

export function LineIcon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}

export function TrustBar() {
  const items: [keyof typeof ICONS, string, string][] = [
    ["shield", "Authentic fragrances", "Arabian, designer and niche scents"],
    ["drop", "Small bottle, big vibes", "Try a scent without a full-size bottle"],
    ["lock", "Secure payment", "Pay online at checkout"],
    ["pin", "Track your order", "Check its status any time"],
  ];
  return (
    <section className="trust-bar" aria-label="Why shop with Esspor">
      {items.map(([icon, title, text]) => (
        <div key={title}>
          <LineIcon name={icon} />
          <strong>{title}</strong>
          <span>{text}</span>
        </div>
      ))}
    </section>
  );
}
