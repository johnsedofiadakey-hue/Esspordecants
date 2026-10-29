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
} from "../components/ui.tsx";
import { navigate } from "../router.ts";

const CONCENTRATIONS = ["Parfum", "Extrait de Parfum", "Eau de Parfum", "Eau de Toilette", "Eau de Cologne", "Eau Fraîche"];
const FAMILIES = ["Amber", "Aromatic", "Chypre", "Citrus", "Floral", "Fougère", "Fruity", "Gourmand", "Green", "Leather", "Musk", "Oud", "Spicy", "Woody"];

type Details = {
  slug: string;
  house: string;
  name: string;
  concentration: string;
  family: string;
  shortDescription: string;
  description: string;
  notesTop: string;
  notesHeart: string;
  notesBase: string;
  sourceBrand: string;
  authenticityCopy: string;
  whatArrives: string;
  copyApproved: boolean;
  bottleMaterial: string;
  capType: string;
  labelVersion: string;
  packagingNotes: string;
};

const toDetails = (product: Product): Details => ({
  slug: product.slug,
  house: product.house,
  name: product.name,
  concentration: product.concentration,
  family: product.family,
  shortDescription: product.shortDescription,
  description: product.description,
  notesTop: product.notes.top.join(", "),
  notesHeart: product.notes.heart.join(", "),
  notesBase: product.notes.base.join(", "),
  sourceBrand: product.sourceBrand,
  authenticityCopy: product.authenticityCopy,
  whatArrives: product.whatArrives,
  copyApproved: product.copyApproved,
  bottleMaterial: product.physical.bottleMaterial,
  capType: product.physical.capType,
  labelVersion: product.physical.labelVersion,
  packagingNotes: product.physical.packagingNotes,
});

const splitNotes = (value: string) =>
  value
    .split(",")
    .map((note) => note.trim())
    .filter(Boolean);

function toPayload(details: Details) {
  return {
    slug: details.slug,
    house: details.house,
    name: details.name,
    concentration: details.concentration,
    family: details.family,
    shortDescription: details.shortDescription,
    description: details.description,
    notes: { top: splitNotes(details.notesTop), heart: splitNotes(details.notesHeart), base: splitNotes(details.notesBase) },
    sourceBrand: details.sourceBrand,
    authenticityCopy: details.authenticityCopy,
    whatArrives: details.whatArrives,
    copyApproved: details.copyApproved,
    physical: {
      bottleMaterial: details.bottleMaterial,
      capType: details.capType,
      labelVersion: details.labelVersion,
      packagingNotes: details.packagingNotes,
    },
  };
}

export function ProductEditor({ id }: { id: string }) {
  const { data: product, setData: setProduct, error, reload } = useLoad(() => api<Product>("GET", `/products/${id}`), [id]);
  const [details, setDetails] = useState<Details | null>(null);
  const [saving, setSaving] = useState(false);
  const [acting, setActing] = useState("");
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

      {product.isSample ? (
        <Notice tone="warn">This is a synthetic sample record for testing the admin. It can be edited but never published.</Notice>
      ) : null}

      <div className="editor">
        <div className="editor-main">
          <form onSubmit={save} className="stack">
            <Card title="Fragrance">
              <div className="grid-2">
                <Field label="House">
                  <Input value={details.house} onChange={(e) => set("house", e.target.value)} required />
                </Field>
                <Field label="Name">
                  <Input value={details.name} onChange={(e) => set("name", e.target.value)} required />
                </Field>
                <Field label="Concentration">
                  <Input list="concentrations" value={details.concentration} onChange={(e) => set("concentration", e.target.value)} />
                </Field>
                <Field label="Scent family" hint="Used for storefront filtering. Keep spelling consistent.">
                  <Input list="families" value={details.family} onChange={(e) => set("family", e.target.value)} />
                </Field>
                <Field label="URL slug" hint="Lowercase words joined by hyphens." wide>
                  <Input value={details.slug} onChange={(e) => set("slug", e.target.value.toLowerCase())} pattern="[a-z0-9]+(-[a-z0-9]+)*" />
                </Field>
              </div>
              <datalist id="concentrations">
                {CONCENTRATIONS.map((value) => (
                  <option key={value} value={value} />
                ))}
              </datalist>
              <datalist id="families">
                {FAMILIES.map((value) => (
                  <option key={value} value={value} />
                ))}
              </datalist>
            </Card>

            <Card title="Copy">
              <div className="grid-2">
                <Field label="Short description" hint={`${details.shortDescription.length}/280 · shown on catalogue cards.`} wide>
                  <Textarea rows={2} maxLength={280} value={details.shortDescription} onChange={(e) => set("shortDescription", e.target.value)} />
                </Field>
                <Field label="Full description" wide>
                  <Textarea rows={6} value={details.description} onChange={(e) => set("description", e.target.value)} />
                </Field>
                <Field label="Top notes" hint="Comma separated. Only verified notes.">
                  <Input value={details.notesTop} onChange={(e) => set("notesTop", e.target.value)} />
                </Field>
                <Field label="Heart notes">
                  <Input value={details.notesHeart} onChange={(e) => set("notesHeart", e.target.value)} />
                </Field>
                <Field label="Base notes">
                  <Input value={details.notesBase} onChange={(e) => set("notesBase", e.target.value)} />
                </Field>
              </div>
            </Card>

            <Card title="Authenticity and what arrives">
              <div className="grid-2">
                <Field label="Source brand" hint="Brand of the original bottle the decant is drawn from.">
                  <Input value={details.sourceBrand} onChange={(e) => set("sourceBrand", e.target.value)} />
                </Field>
                <Field label="Authenticity statement" wide>
                  <Textarea rows={3} value={details.authenticityCopy} onChange={(e) => set("authenticityCopy", e.target.value)} />
                </Field>
                <Field label="What arrives" hint="Exactly what the buyer receives: decant, sprayer, label, packaging." wide>
                  <Textarea rows={3} value={details.whatArrives} onChange={(e) => set("whatArrives", e.target.value)} />
                </Field>
                <div className="field-wide">
                  <Checkbox
                    checked={details.copyApproved}
                    onChange={(value) => set("copyApproved", value)}
                    label="Copy approved for publication"
                    hint="Confirms the description, notes and claims have been checked."
                  />
                </div>
              </div>
            </Card>

            <Card title="Physical decant" actions={<span className="muted small">Must match what ships</span>}>
              <div className="grid-2">
                <Field label="Bottle material">
                  <Input value={details.bottleMaterial} onChange={(e) => set("bottleMaterial", e.target.value)} placeholder="e.g. Clear glass" />
                </Field>
                <Field label="Cap / sprayer type">
                  <Input value={details.capType} onChange={(e) => set("capType", e.target.value)} placeholder="e.g. Black fine-mist atomiser" />
                </Field>
                <Field label="Label version">
                  <Input value={details.labelVersion} onChange={(e) => set("labelVersion", e.target.value)} placeholder="e.g. v1 cream label" />
                </Field>
                <Field label="Packaging notes">
                  <Input value={details.packagingNotes} onChange={(e) => set("packagingNotes", e.target.value)} />
                </Field>
              </div>
            </Card>

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
          <Card title="Publish checklist">
            <ul className="checklist">
              {product.readiness.map((check) => (
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
          </Card>
        </aside>
      </div>
    </>
  );
}

// ---------- Images ----------

function Images({ product, onChange }: { product: Product; onChange: () => Promise<void> }) {
  const [role, setRole] = useState<ImageRole>("decant-front");
  const [alt, setAlt] = useState("");
  const [real, setReal] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const roleHint = IMAGE_ROLES.find((item) => item.value === role)?.hint;

  async function upload(event: FormEvent) {
    event.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.set("file", file);
    form.set("role", role);
    form.set("alt", alt);
    form.set("isRealPhoto", String(real));
    setBusy(true);
    try {
      await api("POST", `/products/${product.id}/images`, form);
      setAlt("");
      setReal(false);
      if (fileRef.current) fileRef.current.value = "";
      await onChange();
      toast.ok("Image uploaded. Review and approve it to make it public.");
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Photos" actions={<span className="muted small">JPEG, PNG or WebP · min 400 × 400 · max 8 MB</span>}>
      <Notice>
        Upload real photographs of the Esspor decant. Concept renders and generated images must not be approved. The first public photo is the decant
        front; source-bottle photos are labelled as the original bottle.
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
        <Field label="Alt text" hint="Describe what is visible, e.g. “Actual 5 ml Esspor decant, front view”.">
          <Input value={alt} onChange={(e) => setAlt(e.target.value)} maxLength={250} />
        </Field>
        <Field label="File">
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" required className="file" />
        </Field>
        <div className="upload-foot">
          <Checkbox checked={real} onChange={setReal} label="This is a real photograph of the item, not a render or concept image" />
          <Button type="submit" tone="primary" busy={busy}>
            Upload
          </Button>
        </div>
      </form>
      {product.images.length === 0 ? (
        <p className="muted">No photos yet.</p>
      ) : (
        <div className="image-grid">
          {product.images.map((image) => (
            <ImageCard key={image.id} productId={product.id} image={image} onChange={onChange} />
          ))}
        </div>
      )}
    </Card>
  );
}

function ImageCard({ productId, image, onChange }: { productId: string; image: AdminImage; onChange: () => Promise<void> }) {
  const [alt, setAlt] = useState(image.alt);
  const toast = useToast();
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
    if (!confirm("Delete this photo?")) return;
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
        <AuthImage src={image.url} alt={image.alt} />
        <span className="image-state">{image.approved ? "Public" : "Not approved"}</span>
      </div>
      <figcaption className="stack-sm">
        <Select value={image.role} onChange={(e) => patch({ role: e.target.value as ImageRole })} aria-label="Image role">
          {IMAGE_ROLES.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </Select>
        <Input
          value={alt}
          placeholder="Alt text"
          aria-label="Alt text"
          onChange={(e) => setAlt(e.target.value)}
          onBlur={() => alt !== image.alt && patch({ alt })}
        />
        <Checkbox checked={image.isRealPhoto} onChange={(value) => patch({ isRealPhoto: value })} label="Real photo" />
        <Checkbox checked={image.approved} onChange={(value) => patch({ approved: value })} label="Approved for storefront" />
        {!image.approved && image.approvalProblems.length ? <p className="small warn-text">{image.approvalProblems.join(" ")}</p> : null}
        <div className="image-meta">
          <span className="muted small">
            {image.width && image.height ? `${image.width}×${image.height}` : ""} · {(image.bytes / 1024).toFixed(0)} KB
          </span>
          <button type="button" className="link-button danger" onClick={remove}>
            Delete
          </button>
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
        Exact decant sizes are pending merchant confirmation. If a size uses a different bottle, tick “Different bottle” and attach its own approved
        photo so the storefront shows what actually ships.
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
              .filter((image) => image.role !== "source-bottle" && image.role !== "editorial")
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
