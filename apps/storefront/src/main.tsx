import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  addToBag,
  readBag,
  setBagQuantity,
  subscribeBag,
  type BagItem,
} from "./bag";
import {
  formatMoney,
  getProduct,
  listProducts,
  type Product,
  type ProductSummary,
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
    url: "/concept/decant.png",
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
      url: "/concept/decant.png",
      alt: "Illustrative decant bottle concept",
      role: "decant-front",
    },
    {
      url: "/concept/hero.png",
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
      </nav>
      <small>© {new Date().getFullYear()} Esspor Decants</small>
    </footer>
  );
}

function Home() {
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
              aria-label="Concept image of a small perfume decant in warm orange light"
            />
            <div className="hero-shade" />
            <div className="hero-glow" aria-hidden="true" />
            <div className="hero-content">
              <p className="eyebrow eyebrow--light">Essence, portioned</p>
              <h1 id="hero-title">
                Find your next
                <br />
                obsession.
              </h1>
              <p className="hero-copy">
                Authentic designer and niche scents,
                <br className="desktop-break" /> decanted for the joy of
                discovery.
              </p>
              <div className="hero-actions">
                <a className="button button--orange" href="/shop">
                  Shop decants <span aria-hidden="true">→</span>
                </a>
                <a
                  className="button button--outline-light"
                  href="/how-it-works"
                >
                  How it works
                </a>
              </div>
            </div>
            <span className="hero-caption">
              Concept imagery · actual bottle to be confirmed
            </span>
            <span className="scroll-cue" aria-hidden="true">
              Scroll to discover <span />
            </span>
          </section>
          <section className="intro section-pad">
            <div data-reveal>
              <p className="eyebrow">The Esspor way</p>
              <h2>
                A world of fragrance,
                <br />
                in your hands.
              </h2>
            </div>
            <p data-reveal>
              Explore without the full-bottle commitment. Every fragrance is
              carefully portioned into a travel-ready decant so you can discover
              what feels like you.
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
                Small portions. Big possibilities.
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

function Shop() {
  const params = new URLSearchParams(window.location.search);
  const query = params.get("query") || "";
  const family = params.get("family") || "";
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
            Explore authentic designer and niche fragrances in Esspor decants.
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
              value={family}
              onChange={(event) => {
                const next = new URLSearchParams(window.location.search);
                if (event.target.value) next.set("family", event.target.value);
                else next.delete("family");
                window.location.href = `/shop?${next}`;
              }}
            >
              <option value="">All scents</option>
              <option value="Woody">Woody</option>
              <option value="Fresh">Fresh</option>
              <option value="Floral">Floral</option>
              <option value="Amber">Amber</option>
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
                  <span className="image-role">
                    {images[selectedImage]?.role === "source-bottle"
                      ? "Original source bottle"
                      : images[selectedImage]?.role === "editorial"
                        ? "Editorial concept"
                        : "Esspor decant"}
                  </span>
                </div>
                <div className="thumbnail-row">
                  {images.map((image, index) => (
                    <button
                      key={`${image.url}-${index}`}
                      className={selectedImage === index ? "selected" : ""}
                      onClick={() => setSelectedImage(index)}
                      aria-label={`View ${image.role.replace("-", " ")} image`}
                      aria-pressed={selectedImage === index}
                    >
                      <img src={image.url} alt="" />
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
                      Added to your bag. <a href="/bag">View bag →</a>
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

function Bag() {
  const items = useBag();
  const estimate = items.reduce(
    (sum, item) => sum + item.priceMinor * item.quantity,
    0,
  );
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
              {items.map((item) => (
                <div className="bag-item" key={item.variantId}>
                  <img src={item.imageUrl} alt={`${item.name} Esspor decant`} />
                  <div>
                    <p className="eyebrow">{item.house}</p>
                    <h2>
                      <a
                        href={`/product/${encodeURIComponent(item.productSlug)}`}
                      >
                        {item.name}
                      </a>
                    </h2>
                    <p>{item.sizeMl} ml decant</p>
                    <label>
                      Quantity{" "}
                      <select
                        value={item.quantity}
                        onChange={(event) =>
                          setBagQuantity(
                            item.variantId,
                            Number(event.target.value),
                          )
                        }
                      >
                        {[0, 1, 2, 3, 4, 5].map((n) => (
                          <option key={n} value={n}>
                            {n === 0 ? "Remove" : n}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <strong>
                    {formatMoney(item.priceMinor * item.quantity)}
                  </strong>
                </div>
              ))}
            </div>
            <aside className="bag-summary">
              <h2>Order summary</h2>
              <p>
                <span>Estimated subtotal</span>
                <strong>{formatMoney(estimate)}</strong>
              </p>
              <small>
                Final price, availability and delivery must be confirmed by the
                Esspor checkout service.
              </small>
              <button className="button button--orange" disabled>
                Checkout being prepared
              </button>
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

function HowItWorks() {
  return (
    <>
      <Header />
      <main className="page-shell story-page">
        <div className="page-hero">
          <p className="eyebrow">The Esspor way</p>
          <h1>
            Small portions.
            <br />
            Big possibilities.
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
