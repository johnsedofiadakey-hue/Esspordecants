import { useEffect, useState, type FormEvent } from "react";
import { api, formatDate, formatMoney, humanize, type Order, type OrderSummary } from "../api.ts";
import { Badge, Button, Card, Empty, Field, Input, Loading, Notice, PageHeader, Select, Textarea, useLoad, useToast } from "../components/ui.tsx";
import { navigate } from "../router.ts";

export function OrderList() {
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (q) params.set("q", q);
  const { data, error } = useLoad(() => api<{ items: OrderSummary[]; statuses: string[] }>("GET", `/orders?${params}`), [status, q]);

  return (
    <>
      <PageHeader title="Orders" subtitle="Server-priced orders. Payment collection is not configured yet." />
      <div className="filters">
        <Input type="search" placeholder="Order number, name or email" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search orders" />
        <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
          <option value="">All statuses</option>
          {(data?.statuses ?? []).map((value) => (
            <option key={value} value={value}>
              {humanize(value)}
            </option>
          ))}
        </Select>
      </div>
      {!data ? (
        <Loading error={error} />
      ) : data.items.length === 0 ? (
        <Empty title="No orders">Orders appear here once checkout is enabled.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Customer</th>
                <th>Status</th>
                <th>Payment</th>
                <th>Total</th>
                <th>Placed</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((order) => (
                <tr key={order.id} className="clickable" onClick={() => navigate(`/orders/${order.id}`)}>
                  <td>
                    <strong className="mono">{order.number}</strong> {order.isSample ? <Badge value="sample" label="synthetic" /> : null}
                  </td>
                  <td>
                    {order.customerName}
                    <div className="muted small">{order.customerEmail}</div>
                  </td>
                  <td>
                    <Badge value={order.status} />
                  </td>
                  <td className="small">{humanize(order.paymentStatus)}</td>
                  <td>{formatMoney(order.totalMinor)}</td>
                  <td className="muted small">{formatDate(order.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export function OrderDetail({ id }: { id: string }) {
  const { data: order, setData, error } = useLoad(() => api<Order>("GET", `/orders/${id}`), [id]);
  const [note, setNote] = useState("");
  const [comment, setComment] = useState("");
  const [internal, setInternal] = useState("");
  const [busy, setBusy] = useState("");
  const toast = useToast();

  useEffect(() => setInternal(order?.internalNotes ?? ""), [order?.internalNotes]);

  if (!order) return <Loading error={error} />;

  async function move(status: string) {
    const destructive = status === "cancelled" || status === "refunded";
    if (destructive && !confirm(`Mark ${order!.number} as ${status}?`)) return;
    setBusy(status);
    try {
      setData(await api<Order>("POST", `/orders/${id}/status`, { status, note }));
      setNote("");
      toast.ok(`Order marked ${humanize(status).toLowerCase()}.`);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy("");
    }
  }

  async function addComment(event: FormEvent) {
    event.preventDefault();
    try {
      setData(await api<Order>("POST", `/orders/${id}/notes`, { note: comment }));
      setComment("");
    } catch (err) {
      toast.error(err);
    }
  }

  async function saveInternal() {
    try {
      setData(await api<Order>("PATCH", `/orders/${id}`, { internalNotes: internal }));
      toast.ok("Notes saved.");
    } catch (err) {
      toast.error(err);
    }
  }

  const address = order.deliveryAddress;

  return (
    <>
      <PageHeader
        back={{ href: "/orders", label: "Orders" }}
        title={<span className="mono">{order.number}</span>}
        subtitle={
          <span className="inline-meta">
            <Badge value={order.status} />
            {order.isSample ? <Badge value="sample" label="synthetic" /> : null}
            <span className="muted small">Placed {formatDate(order.createdAt)}</span>
          </span>
        }
      />
      {order.isSample ? <Notice tone="warn">Synthetic order for testing. Status changes do not move stock.</Notice> : null}
      <div className="editor">
        <div className="editor-main stack">
          <Card title="Items">
            <table className="table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>SKU</th>
                  <th>Qty</th>
                  <th>Unit</th>
                  <th className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {order.items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      {item.house} {item.name} · {item.sizeMl} ml
                    </td>
                    <td className="mono small">{item.sku}</td>
                    <td>{item.quantity}</td>
                    <td>{formatMoney(item.unitPriceMinor)}</td>
                    <td className="num">{formatMoney(item.lineTotalMinor)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4}>Subtotal</td>
                  <td className="num">{formatMoney(order.subtotalMinor)}</td>
                </tr>
                <tr>
                  <td colSpan={4}>Delivery · {order.deliveryLabel || "—"}</td>
                  <td className="num">{formatMoney(order.deliveryMinor)}</td>
                </tr>
                <tr className="total">
                  <td colSpan={4}>Total</td>
                  <td className="num">{formatMoney(order.totalMinor)}</td>
                </tr>
              </tfoot>
            </table>
          </Card>

          <Card title="Timeline">
            <ol className="timeline">
              {order.events.map((event) => (
                <li key={event.id}>
                  <div>
                    <strong>
                      {event.type === "status" && event.to
                        ? `${humanize(event.from ?? "")} → ${humanize(event.to)}`
                        : event.type === "created"
                          ? "Order created"
                          : "Note"}
                    </strong>
                    <span className="muted small">
                      {formatDate(event.createdAt)}
                      {event.actorName ? ` · ${event.actorName}` : ""}
                    </span>
                  </div>
                  {event.note ? <p>{event.note}</p> : null}
                </li>
              ))}
            </ol>
            <form className="inline-form" onSubmit={addComment}>
              <Input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add a note to the timeline" required aria-label="Timeline note" />
              <Button type="submit" size="sm">
                Add note
              </Button>
            </form>
          </Card>
        </div>

        <aside className="editor-side stack">
          <Card title="Update status">
            {order.allowedTransitions.length === 0 ? (
              <p className="muted">This order is closed.</p>
            ) : (
              <>
                <Field label="Note (optional)" hint="Saved with the status change.">
                  <Input value={note} onChange={(e) => setNote(e.target.value)} />
                </Field>
                <div className="button-stack">
                  {order.allowedTransitions.map((status) => (
                    <Button
                      key={status}
                      tone={status === "cancelled" || status === "refunded" ? "danger" : "primary"}
                      busy={busy === status}
                      onClick={() => move(status)}
                    >
                      Mark {humanize(status).toLowerCase()}
                    </Button>
                  ))}
                </div>
              </>
            )}
            <p className="muted small">Payment: {humanize(order.paymentStatus)} · provider {order.paymentProvider}</p>
          </Card>
          <Card title="Customer">
            <p>
              <strong>{order.customerName}</strong>
              <br />
              {order.customerEmail}
              <br />
              {order.customerPhone}
            </p>
            <p className="muted">
              {[address.line1, address.line2, address.city, address.region].filter(Boolean).join(", ")}
              {address.notes ? (
                <>
                  <br />
                  {address.notes}
                </>
              ) : null}
            </p>
          </Card>
          <Card title="Internal notes">
            <Textarea rows={4} value={internal} onChange={(e) => setInternal(e.target.value)} aria-label="Internal notes" />
            <Button size="sm" onClick={saveInternal} disabled={internal === order.internalNotes}>
              Save notes
            </Button>
          </Card>
        </aside>
      </div>
    </>
  );
}
