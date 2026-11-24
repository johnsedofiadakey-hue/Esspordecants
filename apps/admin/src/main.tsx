import { StrictMode, useEffect, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { api, ApiError, setUnauthorizedHandler, type User } from "./api.ts";
import { useOrderAlerts } from "./alerts.ts";
import { signOut as firebaseSignOut, watchUser } from "./auth.ts";
import { Link, Loading, ToastProvider } from "./components/ui.tsx";
import { ContentEditor, ContentList } from "./pages/Content.tsx";
import { Dashboard } from "./pages/Dashboard.tsx";
import { Help } from "./pages/Help.tsx";
import { Login } from "./pages/Login.tsx";
import { OrderDetail, OrderList } from "./pages/Orders.tsx";
import { ProductEditor } from "./pages/ProductEditor.tsx";
import { ProductImport } from "./pages/ProductImport.tsx";
import { ProductWizard } from "./pages/ProductWizard.tsx";
import { ProductList } from "./pages/Products.tsx";
import { Settings } from "./pages/Settings.tsx";
import { navigate, usePath } from "./router.ts";
import "./styles.css";

type IconName = "home" | "bottle" | "bag" | "doc" | "more" | "gear" | "help";

// Plain line icons, drawn here so the admin needs no icon library.
function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    home: <path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
    bottle: <path d="M9 2h6v3l1 2v13a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2V7l1-2zM8 12h8" />,
    bag: <path d="M5 8h14l-1 12H6zM9 8a3 3 0 0 1 6 0" />,
    doc: <path d="M6 3h9l4 4v14H6zM14 3v5h5M9 13h6M9 17h6" />,
    more: (
      <>
        <circle cx="5" cy="12" r="1.4" />
        <circle cx="12" cy="12" r="1.4" />
        <circle cx="19" cy="12" r="1.4" />
      </>
    ),
    gear: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9L7 7M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" />
      </>
    ),
    help: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17h.01" />
      </>
    ),
  };
  return (
    <svg className="icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

const nav: { href: string; label: string; icon: IconName; match: (path: string) => boolean }[] = [
  { href: "/", label: "Overview", icon: "home", match: (path) => path === "/" },
  { href: "/products", label: "Products", icon: "bottle", match: (path) => path.startsWith("/products") },
  { href: "/orders", label: "Orders", icon: "bag", match: (path) => path.startsWith("/orders") },
  { href: "/content", label: "Content", icon: "doc", match: (path) => path.startsWith("/content") },
  { href: "/settings", label: "Settings", icon: "gear", match: (path) => path.startsWith("/settings") },
  { href: "/help", label: "Help", icon: "help", match: (path) => path.startsWith("/help") },
];

// On a phone every table becomes a stack of cards. The CSS needs each cell to know its
// column heading, so this copies the headings onto the cells as pages render.
function useCardTables() {
  useEffect(() => {
    const label = () => {
      document.querySelectorAll<HTMLTableElement>("table.table").forEach((table) => {
        const headings = Array.from(table.querySelectorAll("thead th")).map((cell) => (cell.textContent ?? "").trim());
        table.querySelectorAll("tbody tr").forEach((row) => {
          Array.from(row.children).forEach((cell, index) => {
            const text = headings[index] ?? "";
            if (cell.getAttribute("data-label") !== text) cell.setAttribute("data-label", text);
          });
        });
      });
    };
    label();
    const observer = new MutationObserver(label);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
}

function Route({ path, user }: { path: string; user: User }) {
  const segments = path.split("/").filter(Boolean);
  const [section, id] = segments;
  switch (section) {
    case undefined:
      return <Dashboard />;
    case "products":
      return id === "import" ? <ProductImport /> : id === "new" ? <ProductWizard /> : id ? <ProductEditor id={id} /> : <ProductList />;
    case "orders":
      return id ? <OrderDetail id={id} /> : <OrderList />;
    case "content":
      return id ? <ContentEditor id={id} /> : <ContentList />;
    case "settings":
      return <Settings user={user} />;
    case "help":
      return <Help />;
    default:
      return (
        <div className="empty">
          <strong>Page not found</strong>
          <p>
            <Link href="/">Back to overview</Link>
          </p>
        </div>
      );
  }
}

function App() {
  const path = usePath();
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [denied, setDenied] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const alerts = useOrderAlerts(Boolean(user));
  useCardTables();

  // Firebase keeps the sign-in; the API decides whether that account is an admin.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUser(null);
      void firebaseSignOut();
    });
    let currentUid: string | null = null;
    return watchUser((firebaseUser) => {
      if (!firebaseUser) {
        currentUid = null;
        setUser(null);
        return;
      }
      if (firebaseUser.uid === currentUid) return; // token refresh
      currentUid = firebaseUser.uid;
      api<{ user: User }>("GET", "/auth/me")
        .then((session) => {
          setDenied("");
          setUser(session.user);
        })
        .catch((err) => {
          currentUid = null;
          setDenied(err instanceof ApiError && err.status === 403 ? err.message : "");
          setUser(null);
          void firebaseSignOut();
        });
    });
  }, []);

  useEffect(() => setMenuOpen(false), [path]);

  if (user === undefined) return <Loading />;
  if (user === null) {
    return <Login notice={denied} />;
  }

  async function signOut() {
    await firebaseSignOut().catch(() => {});
    setUser(null);
    navigate("/");
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <img src="/esspor-coffee.svg" alt="Esspor" />
          <span>Admin</span>
        </div>
        <nav aria-label="Admin">
          {nav.map((item) => (
            <Link key={item.href} href={item.href} className={item.match(path) ? "active" : ""} aria-current={item.match(path) ? "page" : undefined}>
              {item.label}
              {item.href === "/orders" && alerts.count > 0 ? <span className="nav-badge" aria-label={`${alerts.count} orders need attention`}>{alerts.count}</span> : null}
            </Link>
          ))}
        </nav>
        <div className="sidebar-foot">
          <label className="alert-toggle">
            <input type="checkbox" checked={alerts.enabled} onChange={(event) => void alerts.setEnabled(event.target.checked)} />
            <span>Chime and pop up for new orders while this tab is open</span>
          </label>
          <div className="who">
            <strong>{user.name}</strong>
            <span>
              {user.email} · {user.role}
            </span>
          </div>
          <button type="button" className="link-button" onClick={signOut}>
            Sign out
          </button>
        </div>
      </aside>
      <div className="main">
        <div className="topbar">
          <img src="/esspor-coffee.svg" alt="Esspor" className="topbar-logo" />
          <span className="topbar-tag">Admin</span>
        </div>
        <main>
          <Route path={path} user={user} />
        </main>
      </div>
      <nav className="bottom-nav" aria-label="Admin">
        {nav.slice(0, 4).map((item) => (
          <Link key={item.href} href={item.href} className={item.match(path) ? "active" : ""} aria-current={item.match(path) ? "page" : undefined}>
            <Icon name={item.icon} />
            <span>{item.label}</span>
            {item.href === "/orders" && alerts.count > 0 ? <span className="nav-badge" aria-label={`${alerts.count} orders need attention`}>{alerts.count}</span> : null}
          </Link>
        ))}
        <button type="button" className={menuOpen || path.startsWith("/settings") || path.startsWith("/help") ? "active" : ""} aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>
          <Icon name="more" />
          <span>More</span>
        </button>
      </nav>
      {menuOpen ? (
        <div className="sheet-backdrop" onClick={() => setMenuOpen(false)}>
          <div className="sheet" role="dialog" aria-label="More" onClick={(event) => event.stopPropagation()}>
            <div className="sheet-who">
              <strong>{user.name}</strong>
              <span>
                {user.email} · {user.role}
              </span>
            </div>
            <Link href="/settings">
              <Icon name="gear" />
              Settings
            </Link>
            <Link href="/help">
              <Icon name="help" />
              Help and guide
            </Link>
            <label className="alert-toggle">
              <input type="checkbox" checked={alerts.enabled} onChange={(event) => void alerts.setEnabled(event.target.checked)} />
              <span>Chime and pop up for new orders while this app is open</span>
            </label>
            <button type="button" className="sheet-signout" onClick={signOut}>
              Sign out
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </StrictMode>,
);
