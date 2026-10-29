import { api, type Summary } from "../api.ts";
import { Badge, Card, Link, Loading, Notice, PageHeader, useLoad } from "../components/ui.tsx";

export function Dashboard() {
  const { data, error } = useSummary();
  if (!data) return <Loading error={error} />;
  return (
    <>
      <PageHeader title="Overview" subtitle="What needs attention across the catalogue and orders." />
      {!data.checkoutEnabled ? (
        <Notice tone="warn">
          Checkout is closed. The storefront can request quotes, but orders cannot be placed until a payment provider and delivery policy are confirmed
          (payment adapter: <code>{data.paymentProvider}</code>, active delivery options: {data.deliveryOptionsActive}).
        </Notice>
      ) : null}
      <div className="stats">
        <Link href="/products" className="stat">
          <span>Published</span>
          <strong>{data.products.published}</strong>
        </Link>
        <Link href="/products" className="stat">
          <span>Drafts</span>
          <strong>{data.products.draft}</strong>
        </Link>
        <Link href="/orders" className="stat">
          <span>Open orders</span>
          <strong>{data.orders.open}</strong>
        </Link>
        <Link href="/orders" className="stat">
          <span>All orders</span>
          <strong>{data.orders.total}</strong>
        </Link>
      </div>
      <Card title="Low and out of stock (published)">
        {data.lowStock.length === 0 ? (
          <p className="muted">Nothing running low.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Size</th>
                <th>SKU</th>
                <th>Stock</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.lowStock.map((row) => (
                <tr key={row.variantId}>
                  <td>
                    <Link href={`/products/${row.productId}`}>{row.label}</Link>
                  </td>
                  <td className="mono">{row.sku}</td>
                  <td>{row.stockQuantity}</td>
                  <td>
                    <Badge value={row.stockStatus} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}

function useSummary() {
  return useLoad(() => api<Summary>("GET", "/summary"), []);
}
