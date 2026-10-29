import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type AnchorHTMLAttributes,
  type ImgHTMLAttributes,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { ApiError, fetchImage } from "../api.ts";
import { navigate } from "../router.ts";

// ---------- Toasts ----------

type Toast = { id: number; tone: "ok" | "error"; text: string };
const ToastContext = createContext<(tone: Toast["tone"], text: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((tone: Toast["tone"], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((list) => [...list, { id, tone, text }]);
    setTimeout(() => setToasts((list) => list.filter((toast) => toast.id !== id)), tone === "error" ? 7000 : 3500);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast-${toast.tone}`}>
            {toast.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const push = useContext(ToastContext);
  return {
    ok: (text: string) => push("ok", text),
    error: (error: unknown) => push("error", errorText(error)),
  };
}

export function errorText(error: unknown): string {
  if (error instanceof ApiError) {
    if (Array.isArray(error.details) && error.details.length && typeof error.details[0] === "object") {
      const parts = (error.details as { message?: string; path?: string }[])
        .map((detail) => (detail.path ? `${detail.path}: ${detail.message}` : detail.message))
        .filter(Boolean);
      if (parts.length) return `${error.message} ${parts.join(" · ")}`;
    }
    return error.message;
  }
  return error instanceof Error ? error.message : "Something went wrong.";
}

// ---------- Data loading ----------

export function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let live = true;
    setError(null);
    load()
      .then((value) => live && setData(value))
      .catch((err) => live && setError(errorText(err)));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version]);
  return { data, setData, error, reload: () => setVersion((v) => v + 1) };
}

// ---------- Primitives ----------

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: "primary" | "secondary" | "ghost" | "danger";
  busy?: boolean;
  size?: "sm" | "md";
};

export function Button({ tone = "secondary", busy, size = "md", className = "", children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      className={`btn btn-${tone} btn-${size} ${className}`}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...rest}
    >
      {busy ? <span className="spinner" aria-hidden /> : null}
      {children}
    </button>
  );
}

export function Link({ href, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return (
    <a
      href={href}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        navigate(href);
      }}
      {...rest}
    >
      {children}
    </a>
  );
}

export function Field({ label, hint, children, wide }: { label: string; hint?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <label className={`field ${wide ? "field-wide" : ""}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

export const Input = (props: InputHTMLAttributes<HTMLInputElement>) => <input className="input" {...props} />;
export const Textarea = (props: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea className="input textarea" {...props} />;
export const Select = (props: SelectHTMLAttributes<HTMLSelectElement>) => <select className="input select" {...props} />;

export function Checkbox({ label, checked, onChange, hint }: { label: ReactNode; checked: boolean; onChange: (value: boolean) => void; hint?: string }) {
  return (
    <label className="checkbox">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>
        {label}
        {hint ? <small>{hint}</small> : null}
      </span>
    </label>
  );
}

const badgeTone: Record<string, string> = {
  published: "green",
  draft: "neutral",
  archived: "muted",
  in_stock: "green",
  low_stock: "amber",
  out_of_stock: "red",
  pending_payment: "amber",
  paid: "blue",
  processing: "blue",
  shipped: "violet",
  delivered: "green",
  cancelled: "muted",
  refunded: "muted",
  sample: "orange",
};

export function Badge({ value, label }: { value: string; label?: string }) {
  return <span className={`badge badge-${badgeTone[value] ?? "neutral"}`}>{label ?? value.replace(/_/g, " ")}</span>;
}

export function Card({ title, actions, children, className = "" }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {title || actions ? (
        <header className="card-head">
          {title ? <h2>{title}</h2> : <span />}
          {actions}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export function PageHeader({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <header className="page-head">
      <div>
        {back ? (
          <Link className="back" href={back.href}>
            ← {back.label}
          </Link>
        ) : null}
        <h1>{title}</h1>
        {subtitle ? <p className="subtitle">{subtitle}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </header>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children ? <p>{children}</p> : null}
    </div>
  );
}

export function Loading({ error }: { error?: string | null }) {
  if (error) return <div className="notice notice-error">{error}</div>;
  return (
    <div className="loading">
      <span className="spinner" aria-hidden /> Loading…
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "error"; children: ReactNode }) {
  return <div className={`notice notice-${tone}`}>{children}</div>;
}

// ---------- Images ----------

export function AuthImage({ src, ...props }: ImgHTMLAttributes<HTMLImageElement> & { src: string }) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  useEffect(() => {
    let revoked = false;
    let url: string | null = null;
    setObjectUrl(null);
    fetchImage(src)
      .then((value) => {
        url = value;
        if (revoked) URL.revokeObjectURL(value);
        else setObjectUrl(value);
      })
      .catch(() => {});
    return () => {
      revoked = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [src]);
  return objectUrl ? <img src={objectUrl} {...props} /> : <span className={`${props.className ?? ""} image-loading`} aria-hidden="true" />;
}
