import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, formatDate, type AdminImage, type ContentEntry } from "../api.ts";
import { AuthImage, Badge, Button, Card, Checkbox, Empty, Field, Input, Loading, PageHeader, Select, Textarea, useLoad, useToast } from "../components/ui.tsx";
import { navigate } from "../router.ts";

export function ContentList() {
  const { data, error } = useLoad(() => api<{ items: ContentEntry[]; placements: string[] }>("GET", "/content"), []);
  const [slug, setSlug] = useState("");
  const [placement, setPlacement] = useState("home-story");
  const toast = useToast();

  async function create(event: FormEvent) {
    event.preventDefault();
    try {
      const entry = await api<ContentEntry>("POST", "/content", { slug, placement });
      navigate(`/content/${entry.id}`);
    } catch (err) {
      toast.error(err);
    }
  }

  return (
    <>
      <PageHeader title="Content" subtitle="Editorial blocks and pages served to the storefront. Only published entries are public." />
      <Card title="New entry">
        <form className="inline-form" onSubmit={create}>
          <Input value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} placeholder="slug, e.g. our-promise" required pattern="[a-z0-9]+(-[a-z0-9]+)*" aria-label="Slug" />
          <Select value={placement} onChange={(e) => setPlacement(e.target.value)} aria-label="Placement">
            {(data?.placements ?? ["home-story"]).map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </Select>
          <Button type="submit" tone="primary">
            Create
          </Button>
        </form>
      </Card>
      {!data ? (
        <Loading error={error} />
      ) : data.items.length === 0 ? (
        <Empty title="No content yet" />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Placement</th>
                <th>Status</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((entry) => (
                <tr key={entry.id} className="clickable" onClick={() => navigate(`/content/${entry.id}`)}>
                  <td>
                    <strong>{entry.title || "Untitled"}</strong>
                    <div className="mono small muted">{entry.slug}</div>
                  </td>
                  <td className="mono small">{entry.placement}</td>
                  <td>
                    <Badge value={entry.status} />
                  </td>
                  <td className="muted small">{formatDate(entry.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

type Form = Pick<ContentEntry, "slug" | "placement" | "eyebrow" | "title" | "body" | "ctaLabel" | "ctaHref" | "imageId" | "sortOrder">;
const toForm = (entry: ContentEntry): Form => ({
  slug: entry.slug,
  placement: entry.placement,
  eyebrow: entry.eyebrow,
  title: entry.title,
  body: entry.body,
  ctaLabel: entry.ctaLabel,
  ctaHref: entry.ctaHref,
  imageId: entry.imageId,
  sortOrder: entry.sortOrder,
});

export function ContentEditor({ id }: { id: string }) {
  const { data: entry, setData, error } = useLoad(() => api<ContentEntry>("GET", `/content/${id}`), [id]);
  const library = useLoad(() => api<{ items: AdminImage[] }>("GET", "/images"), []);
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [alt, setAlt] = useState("");
  const toast = useToast();

  useEffect(() => {
    if (entry) setForm(toForm(entry));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry?.id]);

  if (!entry || !form) return <Loading error={error} />;
  const dirty = JSON.stringify(form) !== JSON.stringify(toForm(entry));
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm({ ...form, [key]: value });
  const selected = library.data?.items.find((image) => image.id === form.imageId) ?? entry.image;

  async function save(event?: FormEvent) {
    event?.preventDefault();
    setBusy(true);
    try {
      const updated = await api<ContentEntry>("PATCH", `/content/${id}`, form);
      setData(updated);
      setForm(toForm(updated));
      toast.ok("Saved.");
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  async function publish(action: "publish" | "unpublish") {
    try {
      setData(await api<ContentEntry>("POST", `/content/${id}/${action}`));
      toast.ok(action === "publish" ? "Published." : "Moved to draft.");
    } catch (err) {
      toast.error(err);
    }
  }

  async function remove() {
    if (!confirm("Delete this entry?")) return;
    try {
      await api("DELETE", `/content/${id}`);
      navigate("/content");
    } catch (err) {
      toast.error(err);
    }
  }

  async function upload() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    const data = new FormData();
    data.set("file", file);
    data.set("alt", alt);
    try {
      const image = await api<AdminImage>("POST", "/images", data);
      library.reload();
      set("imageId", image.id);
      if (fileRef.current) fileRef.current.value = "";
      toast.ok("Uploaded. Approve it below, then save.");
    } catch (err) {
      toast.error(err);
    }
  }

  async function patchImage(image: AdminImage, body: Partial<AdminImage>) {
    try {
      await api("PATCH", `/images/${image.id}`, body);
      library.reload();
      setData(await api<ContentEntry>("GET", `/content/${id}`));
    } catch (err) {
      toast.error(err);
    }
  }

  return (
    <>
      <PageHeader
        back={{ href: "/content", label: "Content" }}
        title={entry.title || "Untitled entry"}
        subtitle={
          <span className="inline-meta">
            <Badge value={entry.status} />
            <span className="mono small">{entry.placement}</span>
          </span>
        }
        actions={
          <>
            {entry.status === "published" ? (
              <Button onClick={() => publish("unpublish")}>Unpublish</Button>
            ) : (
              <Button tone="primary" onClick={() => publish("publish")} disabled={dirty}>
                Publish
              </Button>
            )}
            {entry.status === "draft" ? (
              <Button tone="danger" onClick={remove}>
                Delete
              </Button>
            ) : null}
          </>
        }
      />
      <form onSubmit={save} className="stack">
        <Card title="Copy">
          <div className="grid-2">
            <Field label="Slug">
              <Input value={form.slug} onChange={(e) => set("slug", e.target.value.toLowerCase())} />
            </Field>
            <Field label="Placement" hint="Storefront slot that renders this entry.">
              <Input value={form.placement} onChange={(e) => set("placement", e.target.value)} />
            </Field>
            <Field label="Eyebrow">
              <Input value={form.eyebrow} onChange={(e) => set("eyebrow", e.target.value)} />
            </Field>
            <Field label="Title">
              <Input value={form.title} onChange={(e) => set("title", e.target.value)} />
            </Field>
            <Field label="Body" hint="Plain text. Blank lines separate paragraphs." wide>
              <Textarea rows={8} value={form.body} onChange={(e) => set("body", e.target.value)} />
            </Field>
            <Field label="Button label">
              <Input value={form.ctaLabel} onChange={(e) => set("ctaLabel", e.target.value)} />
            </Field>
            <Field label="Button link" hint="A site path like /shop or an https:// URL.">
              <Input value={form.ctaHref} onChange={(e) => set("ctaHref", e.target.value)} />
            </Field>
            <Field label="Sort order">
              <Input type="number" min="0" value={form.sortOrder} onChange={(e) => set("sortOrder", Number(e.target.value))} />
            </Field>
          </div>
        </Card>
        <Card title="Image">
          <div className="grid-2">
            <Field label="Library image">
              <Select value={form.imageId ?? ""} onChange={(e) => set("imageId", e.target.value || null)}>
                <option value="">No image</option>
                {(library.data?.items ?? []).map((image) => (
                  <option key={image.id} value={image.id}>
                    {image.alt || image.originalName}
                    {image.approved ? "" : " (not approved)"}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Upload new" hint="Editorial images only. Do not upload generated concept art as product photography.">
              <div className="inline-form">
                <Input value={alt} onChange={(e) => setAlt(e.target.value)} placeholder="Alt text" aria-label="Alt text for upload" />
                <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="file" onChange={upload} aria-label="Image file" />
              </div>
            </Field>
          </div>
          {selected ? (
            <div className="content-image">
              <AuthImage src={selected.url} alt={selected.alt} />
              <div className="stack-sm">
                <Checkbox checked={selected.approved} onChange={(value) => patchImage(selected, { approved: value })} label="Approved for storefront" />
                {!selected.approved && selected.approvalProblems.length ? <p className="small warn-text">{selected.approvalProblems.join(" ")}</p> : null}
              </div>
            </div>
          ) : null}
        </Card>
        <div className={`savebar ${dirty ? "visible" : ""}`}>
          <span>Unsaved changes</span>
          <Button onClick={() => setForm(toForm(entry))}>Discard</Button>
          <Button type="submit" tone="primary" busy={busy}>
            Save
          </Button>
        </div>
      </form>
    </>
  );
}
