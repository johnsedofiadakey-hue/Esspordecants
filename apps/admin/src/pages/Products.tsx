import { useState, type FormEvent } from "react";
import { api, formatDate, formatMoney, type Product, type ProductSummary } from "../api.ts";
import { AuthImage, Badge, Button, Card, Empty, Field, Input, Link, Loading, PageHeader, Select, useLoad, useToast } from "../components/ui.tsx";
import { navigate } from "../router.ts";

export function ProductList() {
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (q) params.set("q", q);
  const { data, error } = useLoad(() => api<{ items: ProductSummary[] }>("GET", `/products?${params}`), [status, q]);

  return (
    <>
      <PageHeader
        title="Products"
        subtitle="Fragrances sold as Esspor decants. Products stay private until every publish check passes."
        actions={
          <Button tone="primary" onClick={() => setCreating(true)}>
            New product
          </Button>
        }
      />
      {creating ? <NewProduct onCancel={() => setCreating(false)} /> : null}
      <div className="filters">
        <Input type="search" placeholder="Search house, name or slug" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search products" />
        <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="published">Published</option>
          <option value="archived">Archived</option>
        </Select>
      </div>
      {!data ? (
        <Loading error={error} />
      ) : data.items.length === 0 ? (
        <Empty title="No products yet">Create a draft, add real decant photos and sizes, then publish.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th />
                <th>Fragrance</th>
                <th>Status</th>
                <th>Sizes</th>
                <th>Stock</th>
                <th>From</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((product) => (
                <tr key={product.id} className="clickable" onClick={() => navigate(`/products/${product.id}`)}>
                  <td className="thumb-cell">
                    {product.thumbnailUrl ? <AuthImage src={product.thumbnailUrl} alt="" className="thumb" /> : <span className="thumb thumb-empty" />}
                  </td>
                  <td>
                    <Link href={`/products/${product.id}`} onClick={(e) => e.stopPropagation()}>
                      <strong>{product.name || "Untitled"}</strong>
                    </Link>
                    <div className="muted small">{product.house}</div>
                  </td>
                  <td>
                    <Badge value={product.status} /> {product.isSample ? <Badge value="sample" label="synthetic" /> : null}
                  </td>
                  <td>{product.variantCount}</td>
                  <td>{product.totalStock}</td>
                  <td>{product.minPriceMinor !== null ? formatMoney(product.minPriceMinor) : "—"}</td>
                  <td className="muted small">{formatDate(product.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function NewProduct({ onCancel }: { onCancel: () => void }) {
  const [house, setHouse] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const product = await api<Product>("POST", "/products", { house, name });
      navigate(`/products/${product.id}`);
    } catch (error) {
      toast.error(error);
      setBusy(false);
    }
  }

  return (
    <Card title="New draft product">
      <form className="grid-2" onSubmit={submit}>
        <Field label="Fragrance house" hint="The original brand, e.g. the perfume house.">
          <Input required value={house} onChange={(e) => setHouse(e.target.value)} autoFocus />
        </Field>
        <Field label="Fragrance name">
          <Input required value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="form-actions field-wide">
          <Button onClick={onCancel}>Cancel</Button>
          <Button type="submit" tone="primary" busy={busy}>
            Create draft
          </Button>
        </div>
      </form>
    </Card>
  );
}
