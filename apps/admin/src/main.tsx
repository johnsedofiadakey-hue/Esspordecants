import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { api, ApiError, setUnauthorizedHandler, type User } from "./api.ts";
import { signOut as firebaseSignOut, watchUser } from "./auth.ts";
import { Link, Loading, ToastProvider } from "./components/ui.tsx";
import { ContentEditor, ContentList } from "./pages/Content.tsx";
import { Dashboard } from "./pages/Dashboard.tsx";
import { Login } from "./pages/Login.tsx";
import { OrderDetail, OrderList } from "./pages/Orders.tsx";
import { ProductEditor } from "./pages/ProductEditor.tsx";
import { ProductList } from "./pages/Products.tsx";
import { Settings } from "./pages/Settings.tsx";
import { navigate, usePath } from "./router.ts";
import "./styles.css";

const nav = [
  { href: "/", label: "Overview", match: (path: string) => path === "/" },
  { href: "/products", label: "Products", match: (path: string) => path.startsWith("/products") },
  { href: "/orders", label: "Orders", match: (path: string) => path.startsWith("/orders") },
  { href: "/content", label: "Content", match: (path: string) => path.startsWith("/content") },
  { href: "/settings", label: "Settings", match: (path: string) => path.startsWith("/settings") },
];

function Route({ path, user }: { path: string; user: User }) {
  const segments = path.split("/").filter(Boolean);
  const [section, id] = segments;
  switch (section) {
    case undefined:
      return <Dashboard />;
    case "products":
      return id ? <ProductEditor id={id} /> : <ProductList />;
    case "orders":
      return id ? <OrderDetail id={id} /> : <OrderList />;
    case "content":
      return id ? <ContentEditor id={id} /> : <ContentList />;
    case "settings":
      return <Settings user={user} />;
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
      <aside className={`sidebar ${menuOpen ? "open" : ""}`}>
        <div className="brand">
          <img src="/esspor-coffee.svg" alt="Esspor" />
          <span>Admin</span>
        </div>
        <nav aria-label="Admin">
          {nav.map((item) => (
            <Link key={item.href} href={item.href} className={item.match(path) ? "active" : ""} aria-current={item.match(path) ? "page" : undefined}>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="sidebar-foot">
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
          <button type="button" className="menu-button" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>
            Menu
          </button>
          <img src="/esspor-coffee.svg" alt="Esspor" className="topbar-logo" />
        </div>
        <main>
          <Route path={path} user={user} />
        </main>
      </div>
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
