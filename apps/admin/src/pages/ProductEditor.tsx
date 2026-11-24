import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  api,
  formatDate,
  formatMoney,
  IMAGE_ROLES,
  toCedis,
  toMinor,
  type AdminImage,
  type ImageRole,
  type Product,
  type Variant,
} from "../api.ts";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Field,
  Input,
  Loading,
  Notice,
  PageHeader,
  Select,
  Textarea,
  useLoad,
  useToast,
  AuthImage,
  AuthVideo,
} from "../components/ui.tsx";
import { preparePhoto } from "../media.ts";
import { FragranceSection, ScentSection, SIZES_ML, StorySection, toDetails, toPayload, TrustSection, type Details } from "../productForm.tsx";
import { navigate } from "../router.ts";

export function ProductEditor({ id }: { id: string }) {
  const { data: product, setData: setProduct, error, reload } = useLoad(() => api<Product>("GET", `/products/${id}`), [id]);
  const [details, setDetails] = useState<Details | null>(null);
  const [saving, setSaving] = useState(false);
  const [acting, setActing] = useState("");
  const [checklistOpen, setChecklistOpen] = useState(() => window.innerWidth > 1024);
  const justCreated = new URLSearchParams(window.location.search).get("new") === "1";
  const toast = useToast();

  useEffect(() => {
    if (product) setDetails(toDetails(product));
    // Initialise the form only when a different product loads; photo and size
    // changes refresh the product without discarding unsaved text edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product?.id]);

  if (!product || !details) return <Loading error={error} />;

  const dirty = JSON.stringify(toPayload(details)) !== JSON.stringify(toPayload(toDetails(product)));
  const set = <K extends keyof Details>(key: K, value: Details[K]) => setDetails({ ...details, [key]: value });

  async function save(event?: FormEvent) {
    event?.preventDefault();
    setSaving(true);
    try {
      const updated = await api<Product>("PATCH", `/products/${id}`, toPayload(details!));
      setProduct(updated);
      setDetails(toDetails(updated));
      toast.ok("Product saved.");
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  }

  async function act(action: "publish" | "unpublish" | "archive" | "restore") {
    if (dirty) {
      toast.error(new Error("Save your changes first."));
      return;
    }
    setActing(action);
    try {
      setProduct(await api<Product>("POST", `/products/${id}/${action}`));
      toast.ok(action === "publish" ? "Published. It is now visible on the storefront." : `Product ${action === "restore" ? "restored to draft" : `${action}ed`}.`);
    } catch (err) {
      toast.error(err);
      reload();
    } finally {
      setActing("");
    }
  }

  async function remove() {
    if (!confirm("Delete this product, its sizes and photos? This cannot be undone.")) return;
    try {
      await api("DELETE", `/products/${id}`);
      toast.ok("Product deleted.");
      navigate("/products");
    } catch (err) {
      toast.error(err);
    }
  }

  const refresh = async () => setProduct(await api<Product>("GET", `/products/${id}`));
  const failing = product.readiness.filter((check) => !check.ok);

  return (
    <>
      <PageHeader
        back={{ href: "/products", label: "Products" }}
        title={
          <>
            {product.house ? <span className="eyebrow">{product.house}</span> : null}
            {product.name || "Untitled product"}
          </>
        }
        subtitle={
          <span className="inline-meta">
            <Badge value={product.status} />
            {product.isSample ? <Badge value="sample" label="synthetic sample" /> : null}
            <span className="mono small">/{product.slug}</span>
            <span className="muted small">Updated {formatDate(product.updatedAt)}</span>
          </span>
        }
        actions={
          <>
            {product.status === "published" ? (
              <Button busy={acting === "unpublish"} onClick={() => act("unpublish")}>
                Unpublish
              </Button>
            ) : (
              <Button tone="primary" busy={acting === "publish"} disabled={!product.publishable || dirty} onClick={() => act("publish")}>
                Publish
              </Button>
            )}
            {product.status === "archived" ? (
              <Button busy={acting === "restore"} onClick={() => act("restore")}>
                Restore
              </Button>
            ) : (
              <Button tone="ghost" busy={acting === "archive"} onClick={() => act("archive")}>
                Archive
              </Button>
            )}
            {product.status !== "published" ? (
              <Button tone="danger" onClick={remove}>
                Delete
              </Button>
            ) : null}
          </>
        }
      />

      {justCreated ? (
        <Notice>
          <strong>Draft saved.</strong> Next: add photos of the real decant below, then tick off the publish checklist. Nothing is public until you press Publish.
        </Notice>
      ) : null}
      {product.isSample ? (
        <Notice tone="warn">This is a synthetic sample record for testing the admin. It can be edited but never published.</Notice>
      ) : null}

      <div className="editor">
        <div className="editor-main">
          <form onSubmit={save} className="stack">
            <FragranceSection d={details} set={set} showSlug />
            <ScentSection d={details} set={set} />
            <StorySection d={details} set={set} />
            <TrustSection d={details} set={set} />

            <div className={`savebar ${dirty ? "visible" : ""}`}>
              <span>Unsaved changes</span>
              <Button onClick={() => setDetails(toDetails(product))}>Discard</Button>
              <Button type="submit" tone="primary" busy={saving}>
                Save changes
              </Button>
            </div>
          </form>

          <Images product={product} onChange={refresh} />
          <Variants product={product} onChange={refresh} />
        </div>

        <aside className="editor-side">
          <Card className="checklist-card">
            <button type="button" className="checklist-toggle" aria-expanded={checklistOpen} onClick={() => setChecklistOpen((open) => !open)}>
              <span>
                <strong>Publish checklist</strong>
                <small className="muted">
                  {product.readiness.length - failing.length} of {product.readiness.length} done
                  {product.status === "published" ? " · live" : ""}
                </small>
              </span>
              <span className="checklist-bar" aria-hidden="true">
                <i style={{ width: `${Math.round(((product.readiness.length - failing.length) / product.readiness.length) * 100)}%` }} />
              </span>
            </button>
            {checklistOpen ? (
              <>
                <ul className="checklist">
                  {[...product.readiness].sort((a, b) => Number(a.ok) - Number(b.ok)).map((check) => (
                    <li key={check.code} className={check.ok ? "ok" : "todo"}>
                      <span aria-hidden>{check.ok ? "✓" : "○"}</span>
                      {check.message}
                    </li>
                  ))}
                </ul>
                <p className="muted small">
                  {product.status === "published"
                    ? "Live. Edits that would fail a check are rejected."
                    : failing.length
                      ? `${failing.length} item${failing.length > 1 ? "s" : ""} left before publishing.`
                      : dirty
                        ? "Save changes, then publish."
                        : "Ready to publish."}
                </p>
              </>
            ) : null}
          </Card>
        </aside>
      </div>
    </>
  );
}

// ---------- Images ----------

const MAX_PHOTO_MB = 5;
const MAX_VIDEO_MB = 20;
const MAX_PHOTOS = 16;
const MAX_VIDEOS = 4;

function Images({ product, onChange }: { product: Product; onChange: () => Promise<void> }) {
  const [role, setRole] = useState<ImageRole>("decant-front");
  const [real, setReal] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const roleHint = IMAGE_ROLES.find((item) => item.value === role)?.hint;

  // Several files can be chosen at once. They share the role and the real-photo
  // confirmation; alt text is added per item afterwards, before approving it.
  async function upload(event: FormEvent) {
    event.preventDefault();
    const files = Array.from(fileRef.current?.files ?? []);
    if (!files.length) return;
    setProgress({ done: 0, total: files.length });
    const failed: string[] = [];
    let saved = 0;
    for (const [index, original] of files.entries()) {
      const isVideo = original.type.startsWith("video/");
      if (isVideo && original.size > MAX_VIDEO_MB * 1024 * 1024) {
        failed.push(`${original.name}: videos must be under ${MAX_VIDEO_MB} MB. Export at 720p and keep it short.`);
        setProgress({ done: index + 1, total: files.length });
        continue;
      }
      const prepared = isVideo ? { file: original, savedBytes: 0 } : await preparePhoto(original);
      saved += prepared.savedBytes;
      const file = prepared.file;
      const form = new FormData();
      form.set("file", file);
      form.set("role", role);
      form.set("alt", "");
      form.set("isRealPhoto", String(real));
      try {
        await api("POST", `/products/${product.id}/images`, form);
      } catch (err) {
        failed.push(`${file.name}: ${err instanceof Error ? err.message : "upload failed"}`);
      }
      setProgress({ done: index + 1, total: files.length });
    }
    setProgress(null);
    if (fileRef.current) fileRef.current.value = "";
    await onChange();
    if (failed.length) toast.error(new Error(failed.join(" ")));
    if (failed.length < files.length) {
      const shrunk = saved > 100 * 1024 ? ` Photos were shrunk by ${(saved / 1024 / 1024).toFixed(1)} MB to keep the site fast.` : "";
      toast.ok(`${files.length - failed.length} uploaded.${shrunk} Add a description, then approve each to make it public.`);
    }
  }

  // Order is by role, photos before videos, then this list order; swap neighbours to reorder.
  const ordered = product.images;
  async function move(image: AdminImage, direction: -1 | 1) {
    const index = ordered.findIndex((item) => item.id === image.id);
    const other = ordered[index + direction];
    if (!other || other.role !== image.role || other.kind !== image.kind) return;
    try {
      // The one that ends up first gets the lower number; distinct even if they were equal.
      const [first, second] = direction === -1 ? [image, other] : [other, image];
      const base = Math.min(image.sortOrder, other.sortOrder);
      await api("PATCH", `/products/${product.id}/images/${first.id}`, { sortOrder: base });
      await api("PATCH", `/products/${product.id}/images/${second.id}`, { sortOrder: base + 1 });
    } catch (err) {
      toast.error(err);
    }
    await onChange();
  }

  return (
    <Card title="Photos and videos" actions={<span className="muted small">Photos: JPEG, PNG or WebP, min 400 × 400 · Videos: MP4, MOV or WebM, max {MAX_VIDEO_MB} MB · Up to {MAX_PHOTOS} photos and {MAX_VIDEOS} videos</span>}>
      <Notice>
        Upload real photographs and short videos of the Esspor decant. Concept renders and generated media must not be approved. The first public item is
        always a decant-front photo; source-bottle media is labelled as the original bottle. Choose several files at once. Photos are resized automatically. Every byte shown to a visitor is billed, so keep videos short (about 15 seconds) and exported at 720p.
      </Notice>
      <form className="upload" onSubmit={upload}>
        <Field label="Role" hint={roleHint}>
          <Select value={role} onChange={(e) => setRole(e.target.value as ImageRole)}>
            {IMAGE_ROLES.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Files" hint="Photos and videos can be selected together.">
          <input ref={fileRef} type="file" multiple accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm" required className="file" />
        </Field>
        <div className="upload-foot">
          <Checkbox checked={real} onChange={setReal} label="These are real photographs or videos of the item, not renders or concept media" />
          <Button type="submit" tone="primary" busy={progress !== null}>
            {progress ? `Uploading ${progress.done}/${progress.total}…` : "Upload"}
          </Button>
        </div>
      </form>
      {product.images.length === 0 ? (
        <p className="muted">Nothing uploaded yet.</p>
      ) : (
        <div className="image-grid">
          {product.images.map((image, index) => (
            <ImageCard
              key={image.id}
              productId={product.id}
              image={image}
              onChange={onChange}
              onMove={(direction) => move(image, direction)}
              canMoveUp={ordered[index - 1]?.role === image.role && ordered[index - 1]?.kind === image.kind}
              canMoveDown={ordered[index + 1]?.role === image.role && ordered[index + 1]?.kind === image.kind}
            />
          ))}
        </div>
      )}
    </Card>
  );
}

function ImageCard({
  productId,
  image,
  onChange,
  onMove,
  canMoveUp,
  canMoveDown,
}: {
  productId: string;
  image: AdminImage;
  onChange: () => Promise<void>;
  onMove: (direction: -1 | 1) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}) {
  const [alt, setAlt] = useState(image.alt);
  const toast = useToast();
  const video = image.kind === "video";
  useEffect(() => setAlt(image.alt), [image.alt]);

  async function patch(body: Partial<Pick<AdminImage, "role" | "alt" | "isRealPhoto" | "approved">>) {
    try {
      await api("PATCH", `/products/${productId}/images/${image.id}`, body);
      await onChange();
    } catch (err) {
      toast.error(err);
      await onChange();
    }
  }

  async function remove() {
    if (!confirm(video ? "Delete this video?" : "Delete this photo?")) return;
    try {
      await api("DELETE", `/products/${productId}/images/${image.id}`);
      await onChange();
    } catch (err) {
      toast.error(err);
    }
  }

  return (
    <figure className={`image-card ${image.approved ? "approved" : ""}`}>
      <div className="image-frame">
        {video ? <AuthVideo src={image.url} aria-label={image.alt || image.originalName} /> : <AuthImage src={image.url} alt={image.alt} />}
        <span className="image-state">
          {video ? "Video · " : ""}
          {image.approved ? "Public" : "Not approved"}
        </span>
      </div>
      <figcaption className="stack-sm">
        <Select value={image.role} onChange={(e) => patch({ role: e.target.value as ImageRole })} aria-label="Role">
          {IMAGE_ROLES.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </Select>
        <Input
          value={alt}
          placeholder={video ? "Describe the video" : "Alt text"}
          aria-label={video ? "Video description" : "Alt text"}
          onChange={(e) => setAlt(e.target.value)}
          onBlur={() => alt !== image.alt && patch({ alt })}
        />
        <Checkbox checked={image.isRealPhoto} onChange={(value) => patch({ isRealPhoto: value })} label={video ? "Real footage" : "Real photo"} />
        <Checkbox checked={image.approved} onChange={(value) => patch({ approved: value })} label="Approved for storefront" />
        {!image.approved && image.approvalProblems.length ? <p className="small warn-text">{image.approvalProblems.join(" ")}</p> : null}
        <div className="image-meta">
          <span className="muted small">
            {image.width && image.height ? `${image.width}×${image.height} · ` : ""}
            {image.bytes >= 1024 * 1024 ? `${(image.bytes / 1024 / 1024).toFixed(1)} MB` : `${(image.bytes / 1024).toFixed(0)} KB`}
          </span>
          <span className="image-actions">
            <button type="button" className="link-button" onClick={() => onMove(-1)} disabled={!canMoveUp} aria-label="Move earlier">
              ←
            </button>
            <button type="button" className="link-button" onClick={() => onMove(1)} disabled={!canMoveDown} aria-label="Move later">
              →
            </button>
            <button type="button" className="link-button danger" onClick={remove}>
              Delete
            </button>
          </span>
        </div>
      </figcaption>
    </figure>
  );
}

// ---------- Variants ----------

function Variants({ product, onChange }: { product: Product; onChange: () => Promise<void> }) {
  const [sku, setSku] = useState("");
  const [size, setSize] = useState("");
  const [price, setPrice] = useState("");
  const [stock, setStock] = useState("0");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const letters = (value: string, count: number) => value.normalize("NFD").replace(/[^A-Za-z]/g, "").slice(0, count).toUpperCase();
  const suggestSku = (ml: number) => `${letters(product.house, 3) || "ESS"}-${letters(product.name, 3) || "NEW"}-${ml}`;
  const missing = SIZES_ML.filter((ml) => !product.variants.some((variant) => variant.sizeMl === ml));

  async function add(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await api("POST", `/products/${product.id}/variants`, {
        sku,
        sizeMl: Number(size),
        priceMinor: toMinor(price),
        stockQuantity: Number(stock) || 0,
      });
      setSku("");
      setSize("");
      setPrice("");
      setStock("0");
      await onChange();
      toast.ok("Size added.");
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Sizes, prices and stock" actions={<span className="muted small">Prices in GHS · stored as pesewas</span>}>
      <Notice>
        Each size is its own bottle with its own price and stock count. If a size comes in a different-looking bottle, tick “Different bottle” on it and
        pick a photo of that bottle, so the shop shows what really arrives.
      </Notice>
      {product.variants.length ? (
        <div className="variant-list">
          {product.variants.map((variant) => (
            <VariantRow key={variant.id} productId={product.id} variant={variant} images={product.images} onChange={onChange} />
          ))}
        </div>
      ) : (
        <p className="muted">No sizes yet.</p>
      )}
      {missing.length ? (
        <div className="quick-sizes">
          <span className="muted small">Add a size:</span>
          <div className="chips">
            {missing.map((ml) => (
              <button
                key={ml}
                type="button"
                className={`chip chip-size ${Number(size) === ml ? "on" : ""}`}
                onClick={() => {
                  setSize(String(ml));
                  setSku(suggestSku(ml));
                }}
              >
                {ml} ml
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <form className="variant-add" onSubmit={add}>
        <Field label="SKU">
          <Input value={sku} onChange={(e) => setSku(e.target.value.toUpperCase())} placeholder="ESS-XXX-5" required pattern="[A-Za-z0-9-]{3,40}" />
        </Field>
        <Field label="Size (ml)">
          <Input type="number" min="0.5" step="0.5" value={size} onChange={(e) => setSize(e.target.value)} required />
        </Field>
        <Field label="Price (GHS)">
          <Input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" required />
        </Field>
        <Field label="Opening stock">
          <Input type="number" min="0" step="1" value={stock} onChange={(e) => setStock(e.target.value)} />
        </Field>
        <Button type="submit" tone="primary" busy={busy}>
          Add size
        </Button>
      </form>
    </Card>
  );
}

function VariantRow({ productId, variant, images, onChange }: { productId: string; variant: Variant; images: AdminImage[]; onChange: () => Promise<void> }) {
  const [price, setPrice] = useState(toCedis(variant.priceMinor));
  const [threshold, setThreshold] = useState(String(variant.lowStockThreshold));
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");
  const [showStock, setShowStock] = useState(false);
  const toast = useToast();

  useEffect(() => setPrice(toCedis(variant.priceMinor)), [variant.priceMinor]);

  async function patch(body: Record<string, unknown>) {
    try {
      await api("PATCH", `/products/${productId}/variants/${variant.id}`, body);
      await onChange();
    } catch (err) {
      toast.error(err);
      await onChange();
    }
  }

  async function adjust(event: FormEvent) {
    event.preventDefault();
    try {
      await api("POST", `/products/${productId}/variants/${variant.id}/stock`, { delta: Number(delta), reason });
      setDelta("");
      setReason("");
      setShowStock(false);
      await onChange();
      toast.ok("Stock updated.");
    } catch (err) {
      toast.error(err);
    }
  }

  async function remove() {
    if (!confirm(`Delete size ${variant.sizeMl} ml (${variant.sku})?`)) return;
    try {
      await api("DELETE", `/products/${productId}/variants/${variant.id}`);
      await onChange();
    } catch (err) {
      toast.error(err);
    }
  }

  return (
    <div className={`variant ${variant.active ? "" : "inactive"}`}>
      <div className="variant-head">
        <strong>{variant.sizeMl} ml</strong>
        <span className="mono small">{variant.sku}</span>
        <Badge value={variant.stockStatus} />
        <span className="muted small">
          {variant.stockQuantity} in stock · {formatMoney(variant.priceMinor)}
        </span>
      </div>
      <div className="variant-fields">
        <Field label="Price (GHS)">
          <Input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} onBlur={() => toMinor(price) !== variant.priceMinor && patch({ priceMinor: toMinor(price) })} />
        </Field>
        <Field label="Low-stock alert at">
          <Input
            type="number"
            min="0"
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            onBlur={() => Number(threshold) !== variant.lowStockThreshold && patch({ lowStockThreshold: Number(threshold) })}
          />
        </Field>
        <Field label="Size photo">
          <Select value={variant.imageId ?? ""} onChange={(e) => patch({ imageId: e.target.value || null })}>
            <option value="">Same as product</option>
            {images
              .filter((image) => image.kind === "image" && image.role !== "source-bottle" && image.role !== "editorial")
              .map((image) => (
                <option key={image.id} value={image.id}>
                  {image.role} · {image.alt || image.originalName}
                  {image.approved ? "" : " (not approved)"}
                </option>
              ))}
          </Select>
        </Field>
        <div className="variant-toggles">
          <Checkbox checked={variant.active} onChange={(value) => patch({ active: value })} label="On sale" />
          <Checkbox checked={variant.bottleDiffers} onChange={(value) => patch({ bottleDiffers: value })} label="Different bottle" />
        </div>
      </div>
      <div className="variant-actions">
        <button type="button" className="link-button" onClick={() => setShowStock((open) => !open)}>
          Adjust stock
        </button>
        <button type="button" className="link-button danger" onClick={remove}>
          Delete
        </button>
      </div>
      {showStock ? (
        <form className="stock-form" onSubmit={adjust}>
          <Field label="Change" hint="Positive to add, negative to remove.">
            <Input type="number" step="1" value={delta} onChange={(e) => setDelta(e.target.value)} required />
          </Field>
          <Field label="Reason">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. New batch decanted" required minLength={2} />
          </Field>
          <Button type="submit" tone="primary" size="sm">
            Apply
          </Button>
        </form>
      ) : null}
    </div>
  );
}
