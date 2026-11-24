import { useState, type KeyboardEvent, type ReactNode } from "react";
import type { Product } from "./api.ts";
import { Card, Checkbox, Field, Input, Textarea } from "./components/ui.tsx";

// ---------- The choices a fragrance is described with ----------

export const CONCENTRATIONS = ["Eau de Parfum", "Eau de Toilette", "Parfum / Extrait", "Eau de Cologne", "Attar / Oil", "Body mist"];
export const FAMILIES = ["Woody", "Floral", "Fresh", "Citrus", "Oriental", "Gourmand", "Aromatic", "Musky", "Aquatic", "Leather", "Oud", "Fruity", "Spicy", "Green"];
export const AUDIENCES: { value: Details["audience"]; label: string }[] = [
  { value: "women", label: "For her" },
  { value: "men", label: "For him" },
  { value: "unisex", label: "For anyone" },
];
export const ACCORDS = [
  "vanilla", "oud", "amber", "musk", "sweet", "spicy", "woody", "floral", "fresh", "citrus", "fruity", "powdery",
  "smoky", "leather", "rose", "coffee", "caramel", "tobacco", "coconut", "aquatic", "green", "honey", "saffron", "sandalwood",
];
export const SEASONS = ["spring", "summer", "autumn", "winter"];
export const OCCASIONS: { value: string; label: string }[] = [
  { value: "daily", label: "Everyday" },
  { value: "work", label: "Work" },
  { value: "casual", label: "Casual outings" },
  { value: "evening", label: "Evenings" },
  { value: "date-night", label: "Date night" },
  { value: "special", label: "Special occasions" },
];
export const SIZES_ML = [2, 3, 5, 10, 15, 20, 30];
export const NOTE_SUGGESTIONS = [
  "bergamot", "lemon", "orange", "grapefruit", "mandarin", "pink pepper", "black pepper", "cardamom", "cinnamon", "nutmeg", "saffron", "lavender", "mint",
  "rose", "jasmine", "iris", "geranium", "violet", "ylang-ylang", "tuberose", "orange blossom", "peony", "vanilla", "tonka bean", "amber", "ambergris",
  "musk", "sandalwood", "cedar", "vetiver", "patchouli", "oud", "leather", "tobacco", "coffee", "caramel", "honey", "coconut", "apple", "pear", "peach",
  "blackcurrant", "raspberry", "pineapple", "incense", "benzoin", "labdanum", "sea notes", "green tea", "praline", "dates",
];
export const LONGEVITY_LABELS = ["Soft", "Moderate", "Long", "Very long", "Beast mode"];
export const PROJECTION_LABELS = ["Close to skin", "Gentle", "Noticeable", "Strong", "Fills the room"];

// ---------- The form's state ----------

export type Details = {
  slug: string;
  house: string;
  name: string;
  concentration: string;
  family: string;
  audience: "" | "women" | "men" | "unisex";
  accords: string[];
  notesTop: string[];
  notesHeart: string[];
  notesBase: string[];
  shortDescription: string;
  description: string;
  longevity: number;
  projection: number;
  seasons: string[];
  occasions: string[];
  featured: boolean;
  sourceBrand: string;
  authenticityCopy: string;
  whatArrives: string;
  copyApproved: boolean;
  bottleMaterial: string;
  capType: string;
  labelVersion: string;
  packagingNotes: string;
};

export const emptyDetails = (): Details => ({
  slug: "", house: "", name: "", concentration: "", family: "", audience: "", accords: [], notesTop: [], notesHeart: [], notesBase: [],
  shortDescription: "", description: "", longevity: 0, projection: 0, seasons: [], occasions: [], featured: false,
  sourceBrand: "", authenticityCopy: "", whatArrives: "", copyApproved: false, bottleMaterial: "", capType: "", labelVersion: "", packagingNotes: "",
});

export const toDetails = (product: Product): Details => ({
  slug: product.slug,
  house: product.house,
  name: product.name,
  concentration: product.concentration,
  family: product.family,
  audience: product.audience ?? "",
  accords: product.accords ?? [],
  notesTop: product.notes.top,
  notesHeart: product.notes.heart,
  notesBase: product.notes.base,
  shortDescription: product.shortDescription,
  description: product.description,
  longevity: product.longevity ?? 0,
  projection: product.projection ?? 0,
  seasons: product.seasons ?? [],
  occasions: product.occasions ?? [],
  featured: product.featured ?? false,
  sourceBrand: product.sourceBrand,
  authenticityCopy: product.authenticityCopy,
  whatArrives: product.whatArrives,
  copyApproved: product.copyApproved,
  bottleMaterial: product.physical.bottleMaterial,
  capType: product.physical.capType,
  labelVersion: product.physical.labelVersion,
  packagingNotes: product.physical.packagingNotes,
});

export function toPayload(details: Details, includeSlug = true) {
  return {
    ...(includeSlug && details.slug ? { slug: details.slug } : {}),
    house: details.house.trim(),
    name: details.name.trim(),
    concentration: details.concentration,
    family: details.family,
    audience: details.audience,
    accords: details.accords,
    notes: { top: details.notesTop, heart: details.notesHeart, base: details.notesBase },
    shortDescription: details.shortDescription,
    description: details.description,
    longevity: details.longevity,
    projection: details.projection,
    seasons: details.seasons,
    occasions: details.occasions,
    featured: details.featured,
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

type Setter = <K extends keyof Details>(key: K, value: Details[K]) => void;

// ---------- Tap-to-choose controls ----------

type Option = string | { value: string; label: string };
const optionValue = (option: Option) => (typeof option === "string" ? option : option.value);
const optionLabel = (option: Option) => (typeof option === "string" ? option.replace(/^./, (c) => c.toUpperCase()) : option.label);

// One choice from a short list. With allowOther the person can type something not on it.
export function ChipSelect({ options, value, onChange, allowOther = false, label }: { options: Option[]; value: string; onChange: (value: string) => void; allowOther?: boolean; label: string }) {
  const [other, setOther] = useState("");
  const known = options.map(optionValue);
  const custom = value && !known.includes(value) ? value : "";
  return (
    <div className="chips" role="group" aria-label={label}>
      {options.map((option) => {
        const v = optionValue(option);
        return (
          <button key={v} type="button" className={`chip ${value === v ? "on" : ""}`} aria-pressed={value === v} onClick={() => onChange(value === v ? "" : v)}>
            {optionLabel(option)}
          </button>
        );
      })}
      {custom ? (
        <button type="button" className="chip on" aria-pressed onClick={() => onChange("")}>
          {custom} ×
        </button>
      ) : null}
      {allowOther && !custom ? (
        <input
          className="chip-input"
          placeholder="Other…"
          value={other}
          aria-label={`Other ${label.toLowerCase()}`}
          onChange={(e) => setOther(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && other.trim()) {
              e.preventDefault();
              onChange(other.trim());
              setOther("");
            }
          }}
          onBlur={() => {
            if (other.trim()) {
              onChange(other.trim());
              setOther("");
            }
          }}
        />
      ) : null}
    </div>
  );
}

// Several choices from a list, plus anything typed in.
export function ChipMulti({ options, value, onChange, max = 12, label, allowOther = true }: { options: Option[]; value: string[]; onChange: (value: string[]) => void; max?: number; label: string; allowOther?: boolean }) {
  const [other, setOther] = useState("");
  const known = options.map(optionValue);
  const extras = value.filter((entry) => !known.includes(entry));
  const toggle = (v: string) => {
    if (value.includes(v)) onChange(value.filter((entry) => entry !== v));
    else if (value.length < max) onChange([...value, v]);
  };
  const add = () => {
    const text = other.trim().toLowerCase();
    if (text && !value.includes(text) && value.length < max) onChange([...value, text]);
    setOther("");
  };
  return (
    <div className="chips" role="group" aria-label={label}>
      {options.map((option) => {
        const v = optionValue(option);
        return (
          <button key={v} type="button" className={`chip ${value.includes(v) ? "on" : ""}`} aria-pressed={value.includes(v)} onClick={() => toggle(v)}>
            {optionLabel(option)}
          </button>
        );
      })}
      {extras.map((entry) => (
        <button key={entry} type="button" className="chip on" aria-pressed onClick={() => toggle(entry)}>
          {optionLabel(entry)} ×
        </button>
      ))}
      {allowOther ? (
        <input
          className="chip-input"
          placeholder="Add your own…"
          value={other}
          aria-label={`Add another ${label.toLowerCase()}`}
          onChange={(e) => setOther(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add();
            }
          }}
          onBlur={add}
        />
      ) : null}
    </div>
  );
}

// A list of short words typed in, each becoming a removable tag. Suggestions appear as you type.
export function TagInput({ value, onChange, suggestions = [], placeholder, label, max = 20 }: { value: string[]; onChange: (value: string[]) => void; suggestions?: string[]; placeholder?: string; label: string; max?: number }) {
  const [text, setText] = useState("");
  const id = `tags-${label.replace(/\W+/g, "-").toLowerCase()}`;
  const add = (raw: string) => {
    const word = raw.trim().replace(/,$/, "").trim();
    if (word && !value.some((entry) => entry.toLowerCase() === word.toLowerCase()) && value.length < max) onChange([...value, word]);
    setText("");
  };
  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      add(text);
    } else if (event.key === "Backspace" && !text && value.length) onChange(value.slice(0, -1));
  };
  return (
    <div className="tags">
      {value.map((entry) => (
        <span key={entry} className="tag">
          {entry}
          <button type="button" aria-label={`Remove ${entry}`} onClick={() => onChange(value.filter((other) => other !== entry))}>
            ×
          </button>
        </span>
      ))}
      <input
        className="tag-field"
        list={id}
        value={text}
        placeholder={value.length ? "" : placeholder}
        aria-label={label}
        enterKeyHint="done"
        onChange={(e) => {
          const next = e.target.value;
          // Picking a suggestion from the list adds it straight away.
          if (suggestions.includes(next)) add(next);
          else setText(next);
        }}
        onKeyDown={onKey}
        onBlur={() => add(text)}
      />
      <datalist id={id}>
        {suggestions
          .filter((entry) => !value.includes(entry))
          .map((entry) => (
            <option key={entry} value={entry} />
          ))}
      </datalist>
    </div>
  );
}

// Five dots to rate something. Tap the same dot again to clear it.
export function Dots({ value, onChange, labels, label }: { value: number; onChange: (value: number) => void; labels: string[]; label: string }) {
  return (
    <div className="dots-field">
      <div className="dots" role="group" aria-label={label}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" className={n <= value ? "on" : ""} aria-label={`${n} of 5, ${labels[n - 1]}`} aria-pressed={n === value} onClick={() => onChange(n === value ? 0 : n)} />
        ))}
      </div>
      <span className="muted small">{value ? labels[value - 1] : "Not set"}</span>
    </div>
  );
}

// ---------- The sections, shared by "Add a fragrance" and the editor ----------

export function FragranceSection({ d, set, houses = [], showSlug = false }: { d: Details; set: Setter; houses?: string[]; showSlug?: boolean }) {
  return (
    <Card title="The fragrance">
      <div className="grid-2">
        <Field label="Fragrance house" hint="The original brand, as printed on the bottle.">
          <Input list="houses-list" value={d.house} onChange={(e) => set("house", e.target.value)} required autoComplete="off" />
          <datalist id="houses-list">
            {houses.map((house) => (
              <option key={house} value={house} />
            ))}
          </datalist>
        </Field>
        <Field label="Fragrance name">
          <Input value={d.name} onChange={(e) => set("name", e.target.value)} required autoComplete="off" />
        </Field>
        <Field label="Strength" hint="How concentrated it is, as printed on the bottle." wide>
          <ChipSelect label="Strength" options={CONCENTRATIONS} value={d.concentration} onChange={(v) => set("concentration", v)} allowOther />
        </Field>
        <Field label="Who is it for?" wide>
          <ChipSelect label="Who it is for" options={AUDIENCES} value={d.audience} onChange={(v) => set("audience", v as Details["audience"])} />
        </Field>
        {showSlug ? (
          <Field label="Web address ending" hint="Lowercase words joined by hyphens. Changing it breaks old links." wide>
            <Input value={d.slug} onChange={(e) => set("slug", e.target.value.toLowerCase())} pattern="[a-z0-9]+(-[a-z0-9]+)*" />
          </Field>
        ) : null}
      </div>
    </Card>
  );
}

export function ScentSection({ d, set }: { d: Details; set: Setter }) {
  return (
    <Card title="The scent" actions={<span className="muted small">Helps customers find it</span>}>
      <div className="grid-2">
        <Field label="Scent family" hint="The main character. Pick one." wide>
          <ChipSelect label="Scent family" options={FAMILIES} value={d.family} onChange={(v) => set("family", v)} allowOther />
        </Field>
        <Field label="Flavours" hint="Tap everything that describes how it smells (up to 12). These become the tags and filters in the shop." wide>
          <ChipMulti label="Flavours" options={ACCORDS} value={d.accords} onChange={(v) => set("accords", v)} />
        </Field>
        <Field label="Top notes" hint="What you smell first. Type and press Enter, or pick from the list." wide>
          <TagInput label="Top notes" value={d.notesTop} onChange={(v) => set("notesTop", v)} suggestions={NOTE_SUGGESTIONS} placeholder="e.g. bergamot, pink pepper" />
        </Field>
        <Field label="Heart notes" hint="The middle, after the first few minutes." wide>
          <TagInput label="Heart notes" value={d.notesHeart} onChange={(v) => set("notesHeart", v)} suggestions={NOTE_SUGGESTIONS} placeholder="e.g. rose, saffron" />
        </Field>
        <Field label="Base notes" hint="What lingers for hours." wide>
          <TagInput label="Base notes" value={d.notesBase} onChange={(v) => set("notesBase", v)} suggestions={NOTE_SUGGESTIONS} placeholder="e.g. oud, amber, vanilla" />
        </Field>
      </div>
    </Card>
  );
}

export function StorySection({ d, set }: { d: Details; set: Setter }) {
  return (
    <Card title="Details customers read">
      <div className="grid-2">
        <Field label="One-line summary" hint={`${d.shortDescription.length}/280 · shown on the shop cards.`} wide>
          <Textarea rows={2} maxLength={280} value={d.shortDescription} onChange={(e) => set("shortDescription", e.target.value)} placeholder="e.g. Warm spice and dates over a creamy vanilla base." />
        </Field>
        <Field label="Full description" hint="Describe the scent, the mood, and when to wear it." wide>
          <Textarea rows={6} value={d.description} onChange={(e) => set("description", e.target.value)} />
        </Field>
        <Field label="How long does it last?">
          <Dots label="Longevity" value={d.longevity} onChange={(v) => set("longevity", v)} labels={LONGEVITY_LABELS} />
        </Field>
        <Field label="How far does it travel?">
          <Dots label="Projection" value={d.projection} onChange={(v) => set("projection", v)} labels={PROJECTION_LABELS} />
        </Field>
        <Field label="Best seasons" wide>
          <ChipMulti label="Best seasons" options={SEASONS} value={d.seasons} onChange={(v) => set("seasons", v)} max={4} allowOther={false} />
        </Field>
        <Field label="Best for" wide>
          <ChipMulti label="Best for" options={OCCASIONS} value={d.occasions} onChange={(v) => set("occasions", v)} max={6} allowOther={false} />
        </Field>
        <div className="field-wide">
          <Checkbox checked={d.featured} onChange={(v) => set("featured", v)} label="Feature on the home page" hint="Featured fragrances appear in the highlighted row on the home page." />
        </div>
      </div>
    </Card>
  );
}

export function TrustSection({ d, set, remembered }: { d: Details; set: Setter; remembered?: ReactNode }) {
  return (
    <Card title="What the customer receives" actions={<span className="muted small">Must be true of what you send</span>}>
      {remembered}
      <div className="grid-2">
        <Field label="Original brand" hint="The brand of the original bottle the decant is filled from.">
          <Input value={d.sourceBrand} onChange={(e) => set("sourceBrand", e.target.value)} placeholder={d.house || "e.g. the fragrance house"} />
        </Field>
        <Field label="Packaging notes">
          <Input value={d.packagingNotes} onChange={(e) => set("packagingNotes", e.target.value)} />
        </Field>
        <Field label="Authenticity statement" hint="Shown on the product page. Only say what is true." wide>
          <Textarea rows={3} value={d.authenticityCopy} onChange={(e) => set("authenticityCopy", e.target.value)} placeholder="e.g. Decanted by hand from an authentic, sealed retail bottle." />
        </Field>
        <Field label="What arrives" hint="Exactly what the buyer gets: bottle, sprayer, label, packaging." wide>
          <Textarea rows={3} value={d.whatArrives} onChange={(e) => set("whatArrives", e.target.value)} placeholder="e.g. One 5 ml glass decant with a fine-mist sprayer, labelled and sealed." />
        </Field>
        <Field label="Bottle material">
          <Input value={d.bottleMaterial} onChange={(e) => set("bottleMaterial", e.target.value)} placeholder="e.g. Clear glass" />
        </Field>
        <Field label="Cap or sprayer">
          <Input value={d.capType} onChange={(e) => set("capType", e.target.value)} placeholder="e.g. Black fine-mist sprayer" />
        </Field>
        <Field label="Label version">
          <Input value={d.labelVersion} onChange={(e) => set("labelVersion", e.target.value)} placeholder="e.g. v1 cream label" />
        </Field>
        <div className="field-wide">
          <Checkbox checked={d.copyApproved} onChange={(v) => set("copyApproved", v)} label="I have checked the wording" hint="Confirms the description, notes and claims are accurate. Needed before publishing." />
        </div>
      </div>
    </Card>
  );
}
