import { useState } from "react";
import { api, formatDate, formatMoney, type ProductSummary } from "../api.ts";
import { AuthImage, Badge, Button, Empty, Input, Link, Loading, PageHeader, Select, useLoad } from "../components/ui.tsx";
import { navigate } from "../router.ts";

export function ProductList() {
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
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
          <>
            <Button onClick={() => navigate("/products/import")}>Import from spreadsheet</Button>
            <Button tone="primary" onClick={() => navigate("/products/new")}>
              Add a fragrance
            </Button>
          </>
        }
      />
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
        <ul className="rows">
          {data.items.map((product) => (
            <li key={product.id} className="row" onClick={() => navigate(`/products/${product.id}`)}>
              <div className="row-thumb">
                {product.thumbnailUrl ? <AuthImage src={product.thumbnailUrl} alt="" className="thumb" /> : <span className="thumb thumb-empty" />}
              </div>
              <div className="row-main">
                <div className="row-title">
                  <Link href={`/products/${product.id}`} onClick={(e) => e.stopPropagation()}>
                    <strong>{product.name || "Untitled"}</strong>
                  </Link>
                  <Badge value={product.status} /> {product.isSample ? <Badge value="sample" label="synthetic" /> : null}
                </div>
                <span className="muted">{product.house}</span>
                <div className="row-meta">
                  <span>
                    {product.variantCount} size{product.variantCount === 1 ? "" : "s"}
                  </span>
                  <span>{product.minPriceMinor !== null ? `from ${formatMoney(product.minPriceMinor)}` : "no price yet"}</span>
                  <span>{product.totalStock} in stock</span>
                  <span className="muted">Updated {formatDate(product.updatedAt)}</span>
                </div>
              </div>
              <span className="row-chevron" aria-hidden="true">
                ›
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
