import { useEffect, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import {
  addToBag,
  clearBag,
  readBag,
  readOrders,
  rememberOrder,
  setBagQuantity,
  subscribeBag,
  type BagItem,
} from "./bag";
import {
  formatMoney,
  getProduct,
  getQuote,
  listContent,
  listFamilies,
  listProducts,
  OrderError,
  payForOrder,
  placeOrder,
  trackOrder,
  type ContentEntry,
  type PlacedOrder,
  type TrackedOrder,
  type Product,
  type ProductImage,
  type ProductSummary,
  type Quote,
} from "./api";
import "./styles.css";

const previewProduct: Product = {
  id: "preview-only",
  slug: "example-fragrance",
  status: "published",
  house: "Fragrance house",
  name: "Example fragrance",
  concentration: "Eau de Parfum",
  family: "Warm & woody",
  shortDescription: "A layout preview for an Esspor decant.",
  heroImage: {
    url: "/concept/decant.webp",
    alt: "Illustrative concept of a travel-size decant; final bottle photography pending",
    role: "decant-front",
  },
  minPriceMinor: 0,
  currency: "GHS",
  available: false,
  description:
    "This page shows how an approved fragrance and its Esspor decant will be presented. Real fragrance details and bottle photography will replace this preview before publication.",
  notes: { top: [], heart: [], base: [] },
  images: [
    {
      url: "/concept/decant.webp",
      alt: "Illustrative decant bottle concept",
      role: "decant-front",
    },
    {
      url: "/concept/hero.webp",
      alt: "Editorial concept featuring a small decant bottle",
      role: "editorial",
    },
  ],
  sourceBrand: "To be confirmed",
  authenticityCopy:
    "Authenticity details will be provided with approved catalogue information.",
  whatArrives:
    "A labelled Esspor decant in the chosen size; final packaging details pending confirmation.",
  variants: [2, 5, 10].map((sizeMl) => ({
    id: `preview-${sizeMl}`,
    sku: `PREVIEW-${sizeMl}`,
    sizeMl,
    priceMinor: 0,
    currency: "GHS",
    available: false,
    stockStatus: "preview",
  })),
};

function useBag() {
  const [items, setItems] = useState<BagItem[]>(() => readBag());
  useEffect(() => subscribeBag(() => setItems(readBag())), []);
  return items;
}

function Header({ dark = false }: { dark?: boolean }) {
  const [open, setOpen] = useState(false);
  const items = useBag();
  const count = items.reduce((sum, item) => sum + item.quantity, 0);
  return (
    <>
    <div className="announce-bar" role="note">
      <p>Order before 8PM for next-day delivery | Mon–Fri</p>
    </div>
    <header className={`site-header ${dark ? "site-header--dark" : ""}`}>
      <a className="brand" href="/" aria-label="Esspor Decants home">
        <img
          src={dark ? "/brand/esspor-cream.svg" : "/brand/esspor-coffee.svg"}
          alt="Esspor Decants"
        />
      </a>
      <nav
        className={`main-nav ${open ? "main-nav--open" : ""}`}
        aria-label="Main navigation"
      >
        <a href="/shop">Shop all</a>
        <a href="/how-it-works">How it works</a>
        <a href="/about">Our story</a>
        <a href="/track">Track order</a>
      </nav>
      <div className="header-actions">
        <a href="/shop" aria-label="Search the collection">
          Search
        </a>
        <a href="/bag">Bag ({count})</a>
      </div>
      <button
        className="menu-toggle"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span />
        <span />
        <span />
      </button>
    </header>
    </>
  );
}

function Footer() {
  return (
    <footer className="site-footer">
      <div>
        <img src="/brand/esspor-coffee.svg" alt="Esspor Decants" />
        <p>Essence, portioned for discovery.</p>
      </div>
      <nav aria-label="Footer navigation">
        <a href="/shop">Shop</a>
        <a href="/how-it-works">How it works</a>
        <a href="/about">Our story</a>
        <a href="/track">Track order</a>
      </nav>
      <small>© {new Date().getFullYear()} Esspor Decants</small>
    </footer>
  );
}

// The first published entry for a placement, or null to keep the built-in copy.
function usePlacement(placement: string) {
  const [entry, setEntry] = useState<ContentEntry | null>(null);
  useEffect(() => {
    let active = true;
    listContent(placement)
      .then((result) => {
        if (active) setEntry(result.items[0] ?? null);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [placement]);
  return entry;
}

// Content bodies are plain text; blank lines become line breaks inside one element
// so the existing reveal animation keeps observing the same nodes.
function PlainText({ text }: { text: string }) {
  const paragraphs = text.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
  return (
    <>
      {paragraphs.map((part, index) => (
        <span key={index}>
          {index > 0 && (
            <>
              <br />
              <br />
            </>
          )}
          {part}
        </span>
      ))}
    </>
  );
}

function Home() {
  const hero = usePlacement("home-hero");
  const story = usePlacement("home-story");
  return (
    <>
      <div className="reading-progress" aria-hidden="true" />
      <div className="hero-wrap">
        <Header dark />
        <main>
          <section className="hero" aria-labelledby="hero-title">
            <div
              className="hero-image"
              role="img"
              aria-label={
                hero?.image?.alt ||
                "Concept image of a small perfume decant in warm orange light"
              }
              style={
                hero?.image
                  ? { backgroundImage: `url(${JSON.stringify(hero.image.url)})` }
                  : undefined
              }
            />
            <div className="hero-shade" />
            <div className="hero-glow" aria-hidden="true" />
            <div className="hero-content">
              <p className="eyebrow eyebrow--light">
                {hero?.eyebrow || "Essence, portioned"}
              </p>
              <h1 id="hero-title">
                {hero ? (
                  hero.title
                ) : (
                  <>
                    Find your next
                    <br />
                    obsession.
                  </>
                )}
              </h1>
              <p className="hero-copy">
                {hero?.body ? (
                  <PlainText text={hero.body} />
                ) : (
                  <>
                    Authentic designer and niche scents,
                    <br className="desktop-break" /> decanted for the joy of
                    discovery.
                  </>
                )}
              </p>
              <div className="hero-actions">
                <a
                  className="button button--orange"
                  href={hero?.cta?.href || "/shop"}
                >
                  {hero?.cta?.label || "Shop decants"}{" "}
                  <span aria-hidden="true">→</span>
                </a>
                <a
                  className="button button--outline-light"
                  href="/how-it-works"
                >
                  How it works
                </a>
              </div>
            </div>
            {!hero?.image && (
              <span className="hero-caption">
                Concept imagery · actual bottle to be confirmed
              </span>
            )}
            <span className="scroll-cue" aria-hidden="true">
              Scroll to discover <span />
            </span>
          </section>
          <section className="intro section-pad">
            <div data-reveal>
              <p className="eyebrow">{story?.eyebrow || "The Esspor way"}</p>
              <h2>
                {story ? (
                  story.title
                ) : (
                  <>
                    A world of fragrance,
                    <br />
                    in your hands.
                  </>
                )}
              </h2>
            </div>
            <p data-reveal>
              {story?.body ? (
                <PlainText text={story.body} />
              ) : (
                <>
                  Explore without the full-bottle commitment. Every fragrance
                  is carefully portioned into a travel-ready decant so you can
                  discover what feels like you.
                </>
              )}
            </p>
          </section>
          <section
            className="discover section-pad"
            aria-labelledby="discover-title"
          >
            <div className="section-heading" data-reveal>
              <div>
                <p className="eyebrow">Discover by mood</p>
                <h2 id="discover-title">Where will your scent take you?</h2>
              </div>
              <a className="text-link" href="/shop">
                Explore all <span aria-hidden="true">→</span>
              </a>
            </div>
            <div className="mood-grid">
              <a
                href="/shop?family=Woody"
                className="mood-card mood-card--woody"
                data-reveal
              >
                <div className="mood-card__image" />
                <div className="mood-card__body">
                  <h3>Warm & woody</h3>
                  <p>Deep, grounded, unforgettable.</p>
                  <span aria-hidden="true">→</span>
                </div>
              </a>
              <a
                href="/shop?family=Fresh"
                className="mood-card mood-card--fresh"
                data-reveal
              >
                <div className="mood-card__image" />
                <div className="mood-card__body">
                  <h3>Fresh & clean</h3>
                  <p>A bright start that stays with you.</p>
                  <span aria-hidden="true">→</span>
                </div>
              </a>
              <a
                href="/shop?family=Floral"
                className="mood-card mood-card--floral"
                data-reveal
              >
                <div className="mood-card__image" />
                <div className="mood-card__body">
                  <h3>Soft & floral</h3>
                  <p>The gentler side of statement.</p>
                  <span aria-hidden="true">→</span>
                </div>
              </a>
            </div>
            <p className="concept-note">
              Mood images are visual concepts; published products will use
              approved fragrance photos.
            </p>
          </section>
          <section className="steps section-pad">
            <div className="steps-panel" data-reveal>
              <p className="eyebrow eyebrow--light">
                Small bottle. Big vibes.
              </p>
              <h2>Find it. Try it. Fall for it.</h2>
              <div className="steps-grid">
                <div>
                  <span>01</span>
                  <h3>Choose a fragrance</h3>
                </div>
                <div>
                  <span>02</span>
                  <h3>Pick your decant size</h3>
                </div>
                <div>
                  <span>03</span>
                  <h3>Wear it your way</h3>
                </div>
              </div>
            </div>
          </section>
        </main>
      </div>
      <Footer />
    </>
  );
}

function ProductCard({ product }: { product: ProductSummary }) {
  return (
    <a
      href={`/product/${encodeURIComponent(product.slug)}`}
      className="product-card"
    >
      <div className="product-card__image">
        <img
          src={product.heroImage.url}
          alt={product.heroImage.alt}
          loading="lazy"
        />
      </div>
      <div className="product-card__meta">
        <span>{product.house}</span>
        <span>
          {product.available
            ? `From ${formatMoney(product.minPriceMinor)}`
            : "Currently unavailable"}
        </span>
      </div>
      <h3>{product.name}</h3>
      <p>
        {product.concentration} · {product.family}
      </p>
    </a>
  );
}

// Used until the families endpoint answers, and if it cannot be reached.
const fallbackFamilies = ["Woody", "Fresh", "Floral", "Amber"];

const foldName = (value: string) =>
  value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

function useFamilies(selected: string) {
  const [families, setFamilies] = useState<string[]>(fallbackFamilies);
  useEffect(() => {
    let active = true;
    listFamilies()
      .then((result) => {
        if (active) setFamilies(result.items.map((family) => family.name));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  // Keep a family chosen from a link (e.g. a mood card) selectable even with no products yet.
  const match = families.find((name) => foldName(name) === foldName(selected));
  return {
    families: selected && !match ? [...families, selected] : families,
    selectedFamily: match ?? selected,
  };
}

function Shop() {
  const params = new URLSearchParams(window.location.search);
  const query = params.get("query") || "";
  const family = params.get("family") || "";
  const { families, selectedFamily } = useFamilies(family);
  const [state, setState] = useState<{
    loading: boolean;
    products: ProductSummary[];
    error: boolean;
  }>({ loading: true, products: [], error: false });
  useEffect(() => {
    let active = true;
    listProducts(query, family)
      .then((page) => {
        if (active)
          setState({
            loading: false,
            products: page.items.filter((p) => p.status === "published"),
            error: false,
          });
      })
      .catch(() => {
        if (active) setState({ loading: false, products: [], error: true });
      });
    return () => {
      active = false;
    };
  }, [query, family]);
  return (
    <>
      <Header />
      <main className="page-shell">
        <div className="page-hero">
          <p className="eyebrow">The collection</p>
          <h1>Find your fragrance.</h1>
          <p>
            Explore authentic Arabian, designer and niche fragrances in decants.
          </p>
        </div>
        <div className="catalog-toolbar">
          <form action="/shop" method="get" role="search">
            <label className="sr-only" htmlFor="catalog-query">
              Search fragrances
            </label>
            <input
              id="catalog-query"
              type="search"
              name="query"
              placeholder="Search fragrance or house"
              defaultValue={query}
            />
            <button type="submit">Search</button>
          </form>
          <label>
            Family{" "}
            <select
              value={selectedFamily}
              onChange={(event) => {
                const next = new URLSearchParams(window.location.search);
                if (event.target.value) next.set("family", event.target.value);
                else next.delete("family");
                window.location.href = `/shop?${next}`;
              }}
            >
              <option value="">All scents</option>
              {families.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {state.loading ? (
          <p className="status-panel" role="status">
            Loading the collection…
          </p>
        ) : state.products.length ? (
          <div className="product-grid">
            {state.products.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        ) : (
          <div className="status-panel">
            <h2>
              {state.error
                ? "The collection is being prepared."
                : "No fragrances found yet."}
            </h2>
            <p>
              {state.error
                ? "Approved products will appear here when the Esspor catalogue is connected."
                : "Try another search or scent family."}
            </p>
            {!state.error && (
              <a className="text-link" href="/shop">
                View all scents →
              </a>
            )}
          </div>
        )}
      </main>
      <Footer />
    </>
  );
}

const isVideo = (image?: ProductImage) => image?.kind === "video";

function ProductPage({
  slug,
  preview = false,
}: {
  slug?: string;
  preview?: boolean;
}) {
  const [product, setProduct] = useState<Product | null>(
    preview ? previewProduct : null,
  );
  const [error, setError] = useState("");
  const [selectedImage, setSelectedImage] = useState(0);
  const [selectedVariant, setSelectedVariant] = useState<string>(
    preview ? "preview-5" : "",
  );
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);
  useEffect(() => {
    if (preview || !slug) return;
    let active = true;
    getProduct(slug)
      .then((value) => {
        if (active) {
          setProduct(value);
          setSelectedVariant(
            value.variants.find((v) => v.available)?.id ||
              value.variants[0]?.id ||
              "",
          );
        }
      })
      .catch((cause) => {
        if (active)
          setError(
            cause instanceof Error
              ? cause.message
              : "This fragrance is not available.",
          );
      });
    return () => {
      active = false;
    };
  }, [slug, preview]);
  const images = product
    ? product.images.length
      ? product.images
      : [product.heroImage]
    : [];
  const variant = product?.variants.find((item) => item.id === selectedVariant);
  const canAdd = !preview && !!product?.available && !!variant?.available;
  function add() {
    if (!product || !variant || !canAdd) return;
    addToBag({
      variantId: variant.id,
      productId: product.id,
      productSlug: product.slug,
      house: product.house,
      name: product.name,
      sizeMl: variant.sizeMl,
      priceMinor: variant.priceMinor,
      imageUrl: product.heroImage.url,
      quantity,
    });
    setAdded(true);
  }
  return (
    <>
      <Header />
      <main className="page-shell product-page">
        {preview && (
          <div className="preview-banner">
            Product layout preview · fragrance, bottle, sizes, and price are
            placeholders
          </div>
        )}
        {error ? (
          <div className="status-panel">
            <h1>{error}</h1>
            <a href="/shop" className="text-link">
              Back to the collection →
            </a>
          </div>
        ) : !product ? (
          <p className="status-panel" role="status">
            Loading fragrance…
          </p>
        ) : (
          <>
            <p className="breadcrumbs">
              <a href="/">Home</a> / <a href="/shop">Shop</a> / {product.name}
            </p>
            <div className="product-layout">
              <div className="product-gallery">
                <div className="product-main-image">
                  {isVideo(images[selectedImage]) ? (
                    <video
                      key={images[selectedImage]?.url}
                      src={images[selectedImage]?.url}
                      controls
                      playsInline
                      preload="none"
                      aria-label={images[selectedImage]?.alt || "Product video"}
                    />
                  ) : (
                    <img
                      key={`${selectedImage}-${selectedVariant}`}
                      src={
                        (selectedImage === 0 && variant?.image?.url) ||
                        images[selectedImage]?.url ||
                        product.heroImage.url
                      }
                      alt={
                        (selectedImage === 0 && variant?.image?.alt) ||
                        images[selectedImage]?.alt ||
                        product.heroImage.alt
                      }
                    />
                  )}
                  <span className="image-role">
                    {images[selectedImage]?.role === "source-bottle"
                      ? "Original source bottle"
                      : images[selectedImage]?.role === "editorial"
                        ? preview
                          ? "Editorial concept"
                          : "Editorial"
                        : "Esspor decant"}
                    {isVideo(images[selectedImage]) ? " · video" : ""}
                  </span>
                </div>
                {images[selectedImage]?.role === "source-bottle" ? (
                  <p className="concept-note">
                    {images[selectedImage]?.caption ||
                      "Original full-size bottle, shown for reference. You receive an Esspor decant."}
                  </p>
                ) : null}
                <div className="thumbnail-row">
                  {images.map((image, index) => (
                    <button
                      key={`${image.url}-${index}`}
                      className={selectedImage === index ? "selected" : ""}
                      onClick={() => setSelectedImage(index)}
                      aria-label={`View ${image.role.replace("-", " ")} ${isVideo(image) ? "video" : "image"}`}
                      aria-pressed={selectedImage === index}
                    >
                      {isVideo(image) ? (
                        <>
                          {/* No network request: the clip only downloads when someone presses play. */}
                          <span className="play-badge" aria-hidden="true">
                            ▶
                          </span>
                        </>
                      ) : (
                        <img src={image.url} alt="" loading="lazy" decoding="async" />
                      )}
                    </button>
                  ))}
                </div>
              </div>
              <div className="product-info">
                <p className="eyebrow">Decanted by Esspor</p>
                <h1>{product.name}</h1>
                <p className="product-house">
                  {product.house} · {product.concentration}
                </p>
                <p className="product-description">
                  {product.shortDescription}
                </p>
                <div className="variant-section">
                  <h2>Choose your size</h2>
                  <div className="variant-options">
                    {product.variants.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        className={
                          selectedVariant === option.id ? "selected" : ""
                        }
                        disabled={!option.available && !preview}
                        onClick={() => {
                          setSelectedVariant(option.id);
                          setSelectedImage(0);
                          setAdded(false);
                        }}
                        aria-pressed={selectedVariant === option.id}
                      >
                        {option.sizeMl} ml
                      </button>
                    ))}
                  </div>
                  <p className="variant-help">
                    A travel-size decant prepared from the original fragrance.
                  </p>
                </div>
                <div className="product-buy">
                  <strong>
                    {preview
                      ? "Price pending"
                      : variant
                        ? formatMoney(variant.priceMinor)
                        : "Select a size"}
                  </strong>
                  <p>
                    {preview
                      ? "For layout review only."
                      : variant?.available
                        ? "Availability confirmed at checkout."
                        : "This size is currently unavailable."}
                  </p>
                  <div className="buy-row">
                    <label className="quantity-control">
                      <span className="sr-only">Quantity</span>
                      <select
                        value={quantity}
                        onChange={(event) =>
                          setQuantity(Number(event.target.value))
                        }
                        aria-label="Quantity"
                      >
                        {[1, 2, 3, 4, 5].map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      className="button button--orange"
                      disabled={!canAdd}
                      onClick={add}
                    >
                      {preview
                        ? "Preview only"
                        : canAdd
                          ? "Add to bag →"
                          : "Unavailable"}
                    </button>
                  </div>
                  {added && (
                    <p className="added-message" role="status">
                      Added to your bag. <a href="/bag">Check out →</a>
                    </p>
                  )}
                </div>
                <div className="product-facts">
                  <div>
                    <h2>About the scent</h2>
                    <p>{product.description}</p>
                  </div>
                  <div>
                    <h2>What arrives</h2>
                    <p>{product.whatArrives}</p>
                  </div>
                  <div>
                    <h2>Authenticity</h2>
                    <p>{product.authenticityCopy}</p>
                  </div>
                </div>
              </div>
            </div>
            {product.notes.top.length ||
            product.notes.heart.length ||
            product.notes.base.length ? (
              <section className="notes-section">
                <p className="eyebrow">The scent profile</p>
                <h2>Notes to know</h2>
                <div className="notes-grid">
                  <div>
                    <h3>Top</h3>
                    <p>{product.notes.top.join(" · ") || "—"}</p>
                  </div>
                  <div>
                    <h3>Heart</h3>
                    <p>{product.notes.heart.join(" · ") || "—"}</p>
                  </div>
                  <div>
                    <h3>Base</h3>
                    <p>{product.notes.base.join(" · ") || "—"}</p>
                  </div>
                </div>
              </section>
            ) : null}
          </>
        )}
      </main>
      <Footer />
    </>
  );
}

// Re-quotes whenever the bag or the chosen delivery option changes. The saved bag only
// holds ids, quantities and display details; every price and availability shown here
// comes from the server.
function useQuote(items: BagItem[], deliveryOptionCode: string) {
  const [state, setState] = useState<{ quote: Quote | null; failed: boolean; loading: boolean }>({
    quote: null,
    failed: false,
    loading: items.length > 0,
  });
  const lines = JSON.stringify(items.map(({ variantId, quantity }) => ({ variantId, quantity })));
  useEffect(() => {
    const request = JSON.parse(lines) as { variantId: string; quantity: number }[];
    if (!request.length) {
      setState({ quote: null, failed: false, loading: false });
      return;
    }
    let active = true;
    setState((current) => ({ ...current, loading: true }));
    getQuote(request, deliveryOptionCode || undefined)
      .then((quote) => {
        if (active) setState({ quote, failed: false, loading: false });
      })
      .catch(() => {
        if (active) setState({ quote: null, failed: true, loading: false });
      });
    return () => {
      active = false;
    };
  }, [lines, deliveryOptionCode]);
  return state;
}

const PHONE_PATTERN = "\\+?[0-9][0-9 ()\\-]{6,}";

// One page from bag to order: the items, then how to get them, then who and where.
// Only a full name and phone number are asked for, plus an address for delivery.
function Bag() {
  const items = useBag();
  const [optionCode, setOptionCode] = useState("");
  const { quote, failed, loading } = useQuote(items, optionCode);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [problem, setProblem] = useState("");
  const [placed, setPlaced] = useState<PlacedOrder | null>(null);
  const [redirecting, setRedirecting] = useState(false);
  const lineFor = (variantId: string) => quote?.items.find((line) => line.variantId === variantId);
  const errorFor = (variantId: string) => quote?.errors.find((error) => error.variantId === variantId);

  const options = quote?.deliveryOptions ?? [];
  const optionKey = options.map((option) => option.code).join(",");
  useEffect(() => {
    // Start on the first option so the total always includes how it will arrive.
    if (options.length && !options.some((option) => option.code === optionCode)) {
      setOptionCode(options[0]!.code);
    }
  }, [optionKey]);
  const selected = options.find((option) => option.code === optionCode);
  const needsAddress = selected?.method !== "pickup";
  const blocked = !quote || quote.errors.length > 0 || !quote.items.some((line) => line.available);
  const canOrder = !!quote?.checkoutAvailable && !blocked && !submitting;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canOrder) return;
    setSubmitting(true);
    setProblem("");
    try {
      const result = await placeOrder({
        items: items.map(({ variantId, quantity }) => ({ variantId, quantity })),
        deliveryOptionCode: optionCode || undefined,
        customer: { name, phone, address: needsAddress ? address : undefined },
      });
      rememberOrder(result.order.number);
      clearBag();
      if (result.payment.authorizationUrl) {
        // Hosted checkout (card or mobile money). Paystack sends the customer back to Track order.
        setRedirecting(true);
        window.location.assign(result.payment.authorizationUrl);
        return;
      }
      setPlaced(result);
      window.scrollTo({ top: 0 });
    } catch (cause) {
      setProblem(
        cause instanceof OrderError
          ? cause.code === "quote_changed"
            ? "Something in your bag changed. Please review it and try again."
            : cause.message
          : "Your order could not be placed. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (redirecting) {
    return (
      <>
        <Header />
        <main className="page-shell">
          <p className="status-panel" role="status">
            Taking you to secure payment…
          </p>
        </main>
        <Footer />
      </>
    );
  }

  if (placed) {
    const { order, payment } = placed;
    return (
      <>
        <Header />
        <main className="page-shell">
          <div className="page-hero">
            <p className="eyebrow">Order received</p>
            <h1>Thank you.</h1>
          </div>
          <div className="order-done">
            <div className="order-number" role="group" aria-label="Your order number">
              <span>Your order number</span>
              <strong>{order.number}</strong>
              <CopyButton text={order.number} />
            </div>
            <p className="order-number__note">
              <strong>Take a screenshot of this page.</strong> You'll need this number to check your order's status on Track order. We don't send
              SMS, email or WhatsApp updates.
            </p>
            <ul>
              {order.items.map((item) => (
                <li key={item.sku}>
                  <span>
                    {item.quantity} × {item.name} · {item.sizeMl} ml decant
                  </span>
                  <strong>{formatMoney(item.lineTotalMinor)}</strong>
                </li>
              ))}
              <li>
                <span>{order.deliveryLabel || (order.fulfilmentMethod === "pickup" ? "Pickup" : "Delivery")}</span>
                <strong>{order.deliveryMinor ? formatMoney(order.deliveryMinor) : "Free"}</strong>
              </li>
              <li className="order-done__total">
                <span>Total</span>
                <strong>{formatMoney(order.totalMinor)}</strong>
              </li>
            </ul>
            <p>{payment.message}</p>
            <a href={`/track?number=${encodeURIComponent(order.number)}`} className="button button--orange">
              {payment.status === "failed" ? "Pay now →" : "Track this order →"}
            </a>
          </div>
        </main>
        <Footer />
      </>
    );
  }

  return (
    <>
      <Header />
      <main className="page-shell">
        <div className="page-hero">
          <p className="eyebrow">Your selection</p>
          <h1>Your bag.</h1>
        </div>
        {items.length ? (
          <div className="bag-layout">
            <div>
              {items.map((item) => {
                const line = lineFor(item.variantId);
                const error = errorFor(item.variantId);
                const unavailable = error?.code === "variant_unavailable" || error?.code === "out_of_stock";
                return (
                  <div className="bag-item" key={item.variantId}>
                    <img src={item.imageUrl} alt={`${item.name} Esspor decant`} loading="lazy" decoding="async" />
                    <div>
                      <p className="eyebrow">{item.house}</p>
                      <h2>
                        <a href={`/product/${encodeURIComponent(item.productSlug)}`}>{item.name}</a>
                      </h2>
                      <p>{item.sizeMl} ml decant</p>
                      {unavailable ? (
                        <button type="button" className="text-link" onClick={() => setBagQuantity(item.variantId, 0)}>
                          Remove
                        </button>
                      ) : (
                        <label>
                          Quantity{" "}
                          <select
                            value={item.quantity}
                            onChange={(event) => setBagQuantity(item.variantId, Number(event.target.value))}
                          >
                            {[0, 1, 2, 3, 4, 5].map((n) => (
                              <option key={n} value={n}>
                                {n === 0 ? "Remove" : n}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                      {error ? (
                        <p className="concept-note" role="alert">
                          {error.message}{" "}
                          {error.code === "insufficient_stock" && error.availableQuantity ? (
                            <button
                              type="button"
                              className="text-link"
                              onClick={() => setBagQuantity(item.variantId, error.availableQuantity!)}
                            >
                              Use {error.availableQuantity}
                            </button>
                          ) : null}
                        </p>
                      ) : null}
                    </div>
                    <strong>
                      {line?.available
                        ? formatMoney(line.lineTotalMinor)
                        : loading
                          ? "…"
                          : error?.code === "insufficient_stock" || error?.code === "quantity_limit"
                            ? "Adjust quantity"
                            : error
                              ? "Unavailable"
                              : "—"}
                    </strong>
                  </div>
                );
              })}
            </div>
            <aside className="bag-summary">
              <h2>Checkout</h2>
              <form className="checkout-form" onSubmit={submit}>
                {options.length > 0 ? (
                  <fieldset>
                    <legend>How would you like it?</legend>
                    {options.map((option) => (
                      <label key={option.code} className={`choice ${option.code === optionCode ? "choice--on" : ""}`}>
                        <input
                          type="radio"
                          name="fulfilment"
                          value={option.code}
                          checked={option.code === optionCode}
                          onChange={() => setOptionCode(option.code)}
                        />
                        <span>
                          <strong>{option.method === "pickup" ? `Pick up · ${option.label}` : option.label}</strong>
                          {option.description ? <small>{option.description}</small> : null}
                        </span>
                        <em>{option.priceMinor ? formatMoney(option.priceMinor) : "Free"}</em>
                      </label>
                    ))}
                  </fieldset>
                ) : null}
                <label className="field">
                  Full name
                  <input
                    type="text"
                    name="name"
                    autoComplete="name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    minLength={2}
                    required
                  />
                </label>
                <label className="field">
                  Phone number
                  <input
                    type="tel"
                    name="phone"
                    autoComplete="tel"
                    inputMode="tel"
                    value={phone}
                    onChange={(event) => setPhone(event.target.value)}
                    pattern={PHONE_PATTERN}
                    title="Enter a phone number we can reach you on"
                    required
                  />
                </label>
                {needsAddress ? (
                  <label className="field">
                    Delivery address
                    <textarea
                      name="address"
                      autoComplete="street-address"
                      rows={3}
                      placeholder="Street, area and a landmark"
                      value={address}
                      onChange={(event) => setAddress(event.target.value)}
                      minLength={5}
                      required
                    />
                  </label>
                ) : null}
                <div className="totals">
                  <p>
                    <span>Subtotal</span>
                    <strong>{quote ? formatMoney(quote.subtotalMinor) : loading ? "…" : "—"}</strong>
                  </p>
                  {selected ? (
                    <p>
                      <span>{selected.method === "pickup" ? "Pickup" : "Delivery"}</span>
                      <strong>{quote?.deliveryMinor ? formatMoney(quote.deliveryMinor) : "Free"}</strong>
                    </p>
                  ) : null}
                  <p className="totals__sum">
                    <span>Total</span>
                    <strong>{quote ? formatMoney(quote.totalMinor) : loading ? "…" : "—"}</strong>
                  </p>
                </div>
                <small role={problem ? "alert" : undefined}>
                  {problem ||
                    (failed
                      ? "Prices and availability could not be confirmed right now. Please try again shortly."
                      : quote && !quote.checkoutAvailable
                        ? quote.checkoutMessage
                        : "Prices and availability are confirmed by Esspor.")}
                </small>
                <button className="button button--orange" type="submit" disabled={!canOrder}>
                  {submitting ? "Placing order…" : quote && !quote.checkoutAvailable ? "Checkout being prepared" : "Place order →"}
                </button>
              </form>
              <a href="/shop" className="text-link">
                Continue exploring →
              </a>
            </aside>
          </div>
        ) : (
          <div className="status-panel">
            <h2>Your bag is waiting for a new scent.</h2>
            <p>
              Explore the collection once Esspor’s first fragrances are
              published.
            </p>
            <a href="/shop" className="button button--orange">
              Browse scents →
            </a>
          </div>
        )}
      </main>
      <Footer />
    </>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="copy-button"
      onClick={() => {
        navigator.clipboard?.writeText(text).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          },
          () => {},
        );
      }}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

const TRACK_STEPS = ["paid", "processing", "shipped", "delivered"] as const;

function stepLabel(step: (typeof TRACK_STEPS)[number], pickup: boolean) {
  if (step === "paid") return "Paid";
  if (step === "processing") return "Preparing";
  if (step === "shipped") return pickup ? "Ready for pickup" : "On its way";
  return pickup ? "Collected" : "Delivered";
}

// Anyone with the order number (from the confirmation screenshot) can see where an
// order is. It shows no name, phone or address.
function Track() {
  const initial = new URLSearchParams(window.location.search).get("number") ?? "";
  const [value, setValue] = useState(initial);
  const [order, setOrder] = useState<TrackedOrder | null>(null);
  const [problem, setProblem] = useState("");
  const [loading, setLoading] = useState(false);
  const [paying, setPaying] = useState(false);
  const recent = readOrders();

  async function lookup(number: string, quiet = false) {
    if (!number.trim()) return;
    if (!quiet) setLoading(true);
    setProblem("");
    try {
      const result = await trackOrder(number);
      setOrder(result);
      rememberOrder(result.number);
      window.history.replaceState(null, "", `/track?number=${encodeURIComponent(result.number)}`);
    } catch (cause) {
      if (!quiet) setOrder(null);
      setProblem(cause instanceof Error ? cause.message : "Your order status couldn't be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (initial) lookup(initial);
  }, []);

  // Coming back from paying: keep checking for a minute in case confirmation is a moment behind.
  const pending = order?.status === "pending_payment" && order.canPay;
  useEffect(() => {
    if (!pending || !order) return;
    let tries = 0;
    const timer = setInterval(() => {
      if (++tries > 6) return clearInterval(timer);
      lookup(order.number, true);
    }, 10_000);
    return () => clearInterval(timer);
  }, [pending, order?.number]);

  async function pay() {
    if (!order) return;
    setPaying(true);
    setProblem("");
    try {
      const result = await payForOrder(order.number);
      if (result.authorizationUrl) window.location.assign(result.authorizationUrl);
      else setProblem(result.message);
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : "Payment couldn't be started. Please try again.");
    } finally {
      setPaying(false);
    }
  }

  const pickup = order?.fulfilmentMethod === "pickup";
  const step = order ? TRACK_STEPS.indexOf(order.status as (typeof TRACK_STEPS)[number]) : -1;
  const closed = order?.status === "cancelled" || order?.status === "refunded";
  return (
    <>
      <Header />
      <main className="page-shell">
        <div className="page-hero">
          <p className="eyebrow">Order status</p>
          <h1>Track your order.</h1>
          <p>Enter the order number from your confirmation screenshot.</p>
        </div>
        <form
          className="track-form"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            lookup(value);
          }}
        >
          <label className="sr-only" htmlFor="track-number">
            Order number
          </label>
          <input
            id="track-number"
            type="text"
            name="number"
            placeholder="ESS-1042-7KQ2"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            required
          />
          <button type="submit" className="button button--orange" disabled={loading}>
            {loading ? "Checking…" : "Track →"}
          </button>
        </form>
        {recent.length > 0 && !order ? (
          <p className="track-recent">
            Recent on this device:{" "}
            {recent.map((entry) => (
              <button
                key={entry.number}
                type="button"
                className="text-link"
                onClick={() => {
                  setValue(entry.number);
                  lookup(entry.number);
                }}
              >
                {entry.number}
              </button>
            ))}
          </p>
        ) : null}
        {problem ? (
          <p className="track-problem" role="alert">
            {problem}
          </p>
        ) : null}
        {order ? (
          <section className="track-card" aria-live="polite">
            <p className="eyebrow">Order {order.number}</p>
            <h2>{order.stage.label}</h2>
            <p>{order.stage.detail}</p>
            {order.canPay ? (
              <button type="button" className="button button--orange" onClick={pay} disabled={paying}>
                {paying ? "Opening payment…" : "Pay now →"}
              </button>
            ) : null}
            {!closed ? (
              <ol className="track-steps" aria-label="Progress">
                {TRACK_STEPS.map((name, index) => (
                  <li key={name} className={index <= step ? "done" : ""} aria-current={index === step ? "step" : undefined}>
                    <span aria-hidden="true">{index <= step ? "✓" : index + 1}</span>
                    {stepLabel(name, pickup)}
                  </li>
                ))}
              </ol>
            ) : null}
            <ul className="order-done track-items">
              {order.items.map((item) => (
                <li key={`${item.name}-${item.sizeMl}`}>
                  <span>
                    {item.quantity} × {item.name} · {item.sizeMl} ml decant
                  </span>
                </li>
              ))}
              <li className="order-done__total">
                <span>{pickup ? "Pickup" : "Delivery"} · Total</span>
                <strong>{formatMoney(order.totalMinor)}</strong>
              </li>
            </ul>
            <h3>History</h3>
            <ul className="track-history">
              {[...order.timeline].reverse().map((entry, index) => (
                <li key={`${entry.label}-${index}`}>
                  <strong>{entry.label}</strong>
                  <span>
                    {new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(entry.at))}
                  </span>
                </li>
              ))}
            </ul>
            <button type="button" className="text-link" onClick={() => lookup(order.number)}>
              Refresh status
            </button>
          </section>
        ) : null}
      </main>
      <Footer />
    </>
  );
}

function HowItWorks() {
  return (
    <>
      <Header />
      <main className="page-shell story-page">
        <div className="page-hero">
          <p className="eyebrow">The Esspor way</p>
          <h1>
            Small bottle.
            <br />
            Big vibes.
          </h1>
          <p>Explore fragrances without committing to a full-size bottle.</p>
        </div>
        <div className="story-steps">
          <article>
            <span>01</span>
            <h2>Find a fragrance</h2>
            <p>Browse designer and niche scents by house, notes, or mood.</p>
          </article>
          <article>
            <span>02</span>
            <h2>Choose your size</h2>
            <p>
              Pick the decant size that suits your discovery. Every size is
              shown clearly before you buy.
            </p>
          </article>
          <article>
            <span>03</span>
            <h2>Make it yours</h2>
            <p>
              Receive a labelled, travel-ready Esspor decant prepared from the
              original fragrance.
            </p>
          </article>
        </div>
        <a href="/shop" className="button button--orange">
          Explore the collection →
        </a>
      </main>
      <Footer />
    </>
  );
}

function About() {
  return (
    <>
      <Header />
      <main className="page-shell story-page">
        <div className="page-hero">
          <p className="eyebrow">Our story</p>
          <h1>Essence, portioned.</h1>
          <p>Luxury fragrance discovery, made more accessible.</p>
        </div>
        <div className="about-panel">
          <p>
            Esspor makes authentic designer and niche fragrances accessible
            through high-quality decants. It helps you explore luxury fragrances
            without committing to expensive full-size bottles.
          </p>
          <p>
            We believe finding a scent should feel personal, playful, and
            considered. Each portion creates room to discover what you love.
          </p>
        </div>
        <a href="/how-it-works" className="text-link">
          See how it works →
        </a>
      </main>
      <Footer />
    </>
  );
}

function App() {
  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (preference.matches) return;

    const revealItems = document.querySelectorAll<HTMLElement>("[data-reveal]");
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -32px 0px" },
    );
    revealItems.forEach((item) => observer.observe(item));
    document.documentElement.classList.add("motion-ready");

    const hero = document.querySelector<HTMLElement>(".hero");
    const steps = document.querySelector<HTMLElement>(".steps-grid");
    let frame = 0;
    const update = () => {
      frame = 0;
      const scrollRange = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      document.documentElement.style.setProperty("--page-progress", `${Math.min(100, (window.scrollY / scrollRange) * 100)}%`);
      if (hero) {
        const amount = Math.min(1, Math.max(0, window.scrollY / hero.offsetHeight));
        hero.style.setProperty("--hero-parallax", `${Math.round(amount * 58)}px`);
      }
      if (steps) {
        const rect = steps.getBoundingClientRect();
        const start = window.innerHeight * 0.8;
        const finish = window.innerHeight * 0.28;
        const amount = Math.min(1, Math.max(0, (start - rect.top) / (start - finish)));
        steps.style.setProperty("--steps-progress", `${Math.round(amount * 100)}%`);
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame) cancelAnimationFrame(frame);
      document.documentElement.classList.remove("motion-ready");
    };
  }, []);

  const path = decodeURIComponent(window.location.pathname);
  if (path === "/") return <Home />;
  if (path === "/shop") return <Shop />;
  if (path === "/bag") return <Bag />;
  if (path === "/track") return <Track />;
  if (path === "/how-it-works") return <HowItWorks />;
  if (path === "/about") return <About />;
  if (path === "/preview/product") return <ProductPage preview />;
  if (path.startsWith("/product/"))
    return <ProductPage slug={path.slice("/product/".length)} />;
  return (
    <>
      <Header />
      <main className="page-shell">
        <div className="status-panel">
          <h1>Page not found</h1>
          <a className="text-link" href="/">
            Back to Esspor →
          </a>
        </div>
      </main>
      <Footer />
    </>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
