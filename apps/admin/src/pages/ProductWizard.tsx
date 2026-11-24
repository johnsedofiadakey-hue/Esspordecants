import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { api, toMinor, type Product, type ProductSummary } from "../api.ts";
import { Button, Card, Field, Input, Notice, PageHeader, useToast } from "../components/ui.tsx";
import {
  emptyDetails,
  FragranceSection,
  ScentSection,
  SIZES_ML,
  StorySection,
  toPayload,
  TrustSection,
  type Details,
} from "../productForm.tsx";
import { navigate } from "../router.ts";

type SizeRow = { sizeMl: number; price: string; stock: string; sku: string; skuEdited: boolean };

type Draft = { details: Details; sizes: SizeRow[] };

const DRAFT_KEY = "esspor-new-product-draft";
const TRUST_KEY = "esspor-trust-defaults";
const TRUST_FIELDS = ["authenticityCopy", "whatArrives", "bottleMaterial", "capType", "labelVersion"] as const;

const letters = (value: string, count: number) => value.normalize("NFD").replace(/[^A-Za-z]/g, "").slice(0, count).toUpperCase();

// A starting point for the code that identifies each size, e.g. LAT-KHA-5. It can be edited.
const skuFor = (house: string, name: string, sizeMl: number) => `${letters(house, 3) || "ESS"}-${letters(name, 3) || "NEW"}-${sizeMl}`;

function readStore<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) || "null") as T | null;
  } catch {
    return null;
  }
}

function writeStore(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Remembering is a convenience only.
  }
}

export function ProductWizard() {
  const toast = useToast();
  const [details, setDetails] = useState<Details>(emptyDetails);
  const [sizes, setSizes] = useState<SizeRow[]>([]);
  const [otherSize, setOtherSize] = useState("");
  const [houses, setHouses] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [restored, setRestored] = useState(false);
  const [prefilled, setPrefilled] = useState(false);
  const loaded = useRef(false);

  // Pick up where an interrupted session left off, or reuse the wording from the last product.
  useEffect(() => {
    const draft = readStore<Draft>(DRAFT_KEY);
    if (draft && (draft.details.house || draft.details.name || draft.sizes.length)) {
      setDetails({ ...emptyDetails(), ...draft.details });
      setSizes(draft.sizes);
      setRestored(true);
    } else {
      const trust = readStore<Partial<Details>>(TRUST_KEY);
      if (trust) {
        setDetails((current) => ({ ...current, ...trust }));
        setPrefilled(true);
      }
    }
    loaded.current = true;
    api<{ items: ProductSummary[] }>("GET", "/products")
      .then((result) => setHouses([...new Set(result.items.map((item) => item.house).filter(Boolean))].sort()))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (loaded.current) writeStore(DRAFT_KEY, { details, sizes });
  }, [details, sizes]);

  const set = <K extends keyof Details>(key: K, value: Details[K]) => setDetails((current) => ({ ...current, [key]: value }));

  // Keep suggested codes in step with the name until someone edits one by hand.
  useEffect(() => {
    setSizes((rows) => rows.map((row) => (row.skuEdited ? row : { ...row, sku: skuFor(details.house, details.name, row.sizeMl) })));
  }, [details.house, details.name]);

  const toggleSize = (sizeMl: number) =>
    setSizes((rows) =>
      rows.some((row) => row.sizeMl === sizeMl)
        ? rows.filter((row) => row.sizeMl !== sizeMl)
        : [...rows, { sizeMl, price: "", stock: "", sku: skuFor(details.house, details.name, sizeMl), skuEdited: false }].sort((a, b) => a.sizeMl - b.sizeMl),
    );

  const addOther = () => {
    const value = Number(otherSize.replace(",", "."));
    if (value > 0 && value <= 200 && !sizes.some((row) => row.sizeMl === value)) toggleSize(value);
    setOtherSize("");
  };

  const patchSize = (sizeMl: number, patch: Partial<SizeRow>) => setSizes((rows) => rows.map((row) => (row.sizeMl === sizeMl ? { ...row, ...patch } : row)));

  const priced = sizes.filter((row) => toMinor(row.price) > 0);
  const progress = useMemo(
    () => [
      { id: "step-fragrance", label: "Fragrance", done: Boolean(details.house.trim() && details.name.trim()) },
      { id: "step-scent", label: "Scent", done: Boolean(details.family && details.accords.length) },
      { id: "step-sizes", label: "Sizes", done: sizes.length > 0 && priced.length === sizes.length },
      { id: "step-details", label: "Details", done: Boolean(details.shortDescription.trim() && details.description.trim()) },
      { id: "step-receives", label: "Receives", done: Boolean(details.authenticityCopy.trim() && details.whatArrives.trim() && details.bottleMaterial.trim() && details.capType.trim() && details.labelVersion.trim()) },
    ],
    [details, sizes, priced.length],
  );

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!details.house.trim() || !details.name.trim()) {
      toast.error(new Error("Add the fragrance house and name first."));
      document.getElementById("step-fragrance")?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (sizes.some((row) => toMinor(row.price) <= 0) && !confirm("Some sizes have no price yet. Save anyway? You can set prices later, but it can't be published until every size has one.")) return;
    setBusy(true);
    let created: Product | null = null;
    const problems: string[] = [];
    try {
      created = await api<Product>("POST", "/products", { ...toPayload({ ...details, sourceBrand: details.sourceBrand || details.house }, false) });
      for (const row of sizes) {
        try {
          await api("POST", `/products/${created.id}/variants`, {
            sku: row.sku,
            sizeMl: row.sizeMl,
            priceMinor: Math.max(0, toMinor(row.price) || 0),
            stockQuantity: Math.max(0, Math.floor(Number(row.stock) || 0)),
          });
        } catch (err) {
          problems.push(`${row.sizeMl} ml: ${err instanceof Error ? err.message : "could not be added"}`);
        }
      }
    } catch (err) {
      toast.error(err);
      setBusy(false);
      return;
    }
    writeStore(DRAFT_KEY, null);
    writeStore(TRUST_KEY, Object.fromEntries(TRUST_FIELDS.map((field) => [field, details[field]])));
    if (problems.length) toast.error(new Error(`Saved, but some sizes need attention: ${problems.join(" ")}`));
    else toast.ok("Draft saved. Now add photos.");
    navigate(`/products/${created.id}?new=1`);
  }

  function startFresh() {
    if (!confirm("Clear everything on this page and start again?")) return;
    writeStore(DRAFT_KEY, null);
    setDetails(emptyDetails());
    setSizes([]);
    setRestored(false);
    setPrefilled(false);
  }

  return (
    <form onSubmit={save} className="wizard">
      <PageHeader
        back={{ href: "/products", label: "Products" }}
        title="Add a fragrance"
        subtitle="Fill in what you know. Everything saves as a draft: nothing goes on the shop until you add photos and publish it."
      />
      {restored ? (
        <Notice>
          Picked up where you left off.{" "}
          <button type="button" className="link-button" onClick={startFresh}>
            Start again
          </button>
        </Notice>
      ) : null}

      <nav className="wizard-progress" aria-label="Progress">
        {progress.map((step) => (
          <a key={step.id} href={`#${step.id}`} className={step.done ? "done" : ""} onClick={(e) => { e.preventDefault(); document.getElementById(step.id)?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>
            <span aria-hidden="true">{step.done ? "✓" : ""}</span>
            {step.label}
          </a>
        ))}
      </nav>

      <div className="stack">
        <div id="step-fragrance" className="anchor">
          <FragranceSection d={details} set={set} houses={houses} />
        </div>
        <div id="step-scent" className="anchor">
          <ScentSection d={details} set={set} />
        </div>

        <div id="step-sizes" className="anchor">
          <Card title="Bottle sizes and prices" actions={<span className="muted small">One price per size</span>}>
            <p className="muted">Tap every size you sell this fragrance in. You can add or change sizes any time.</p>
            <div className="chips" role="group" aria-label="Bottle sizes">
              {SIZES_ML.map((size) => (
                <button key={size} type="button" className={`chip chip-size ${sizes.some((row) => row.sizeMl === size) ? "on" : ""}`} aria-pressed={sizes.some((row) => row.sizeMl === size)} onClick={() => toggleSize(size)}>
                  {size} ml
                </button>
              ))}
              {sizes.filter((row) => !SIZES_ML.includes(row.sizeMl)).map((row) => (
                <button key={row.sizeMl} type="button" className="chip chip-size on" aria-pressed onClick={() => toggleSize(row.sizeMl)}>
                  {row.sizeMl} ml ×
                </button>
              ))}
              <span className="chip-other">
                <input
                  className="chip-input"
                  inputMode="decimal"
                  placeholder="Other ml…"
                  aria-label="Another size in ml"
                  value={otherSize}
                  onChange={(e) => setOtherSize(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addOther();
                    }
                  }}
                  onBlur={addOther}
                />
              </span>
            </div>
            {sizes.length === 0 ? (
              <p className="muted small">No sizes chosen yet.</p>
            ) : (
              <div className="size-rows">
                {sizes.map((row) => (
                  <div className="size-row" key={row.sizeMl}>
                    <div className="size-row-head">
                      <strong>{row.sizeMl} ml</strong>
                      <button type="button" className="link-button danger" onClick={() => toggleSize(row.sizeMl)}>
                        Remove
                      </button>
                    </div>
                    <div className="size-row-fields">
                      <Field label="Price (GH₵)">
                        <Input inputMode="decimal" placeholder="0.00" value={row.price} onChange={(e) => patchSize(row.sizeMl, { price: e.target.value })} />
                      </Field>
                      <Field label="In stock">
                        <Input inputMode="numeric" placeholder="0" value={row.stock} onChange={(e) => patchSize(row.sizeMl, { stock: e.target.value.replace(/\D/g, "") })} />
                      </Field>
                      <Field label="Code (SKU)" hint="Made for you. Change it if you use your own.">
                        <Input className="mono" value={row.sku} onChange={(e) => patchSize(row.sizeMl, { sku: e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ""), skuEdited: true })} />
                      </Field>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div id="step-details" className="anchor">
          <StorySection d={details} set={set} />
        </div>
        <div id="step-receives" className="anchor">
          <TrustSection
            d={details}
            set={set}
            remembered={prefilled ? <Notice>The wording and bottle details are filled in from your last fragrance. Check they are right for this one.</Notice> : null}
          />
        </div>
      </div>

      <div className="wizard-bar">
        <span className="muted small">
          {progress.filter((step) => step.done).length} of {progress.length} sections filled
        </span>
        <Button type="submit" tone="primary" busy={busy}>
          Save draft and add photos
        </Button>
      </div>
    </form>
  );
}
