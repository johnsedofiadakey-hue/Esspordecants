import { useEffect, useState, type FormEvent } from "react";
import { api, formatDate, formatMoney, humanize, toCedis, toMinor, type DeliveryOption, type SiteSettings, type TeamMember, type User } from "../api.ts";
import { authErrorText, changePassword } from "../auth.ts";
import { Badge, Button, Card, Checkbox, Field, Input, Loading, Notice, PageHeader, Select, Textarea, useLoad, useToast } from "../components/ui.tsx";

const MIN_PASSWORD = 12;

export function Settings({ user }: { user: User }) {
  const owner = user.role === "owner";
  return (
    <>
      <PageHeader title="Settings" subtitle="Your account, team, delivery options and activity." />
      <Account />
      {owner ? <StoreDetails /> : null}
      {owner ? <Team me={user} /> : null}
      <Delivery owner={owner} />
      {owner ? <Audit /> : null}
    </>
  );
}

function StoreDetails() {
  const { data, error } = useLoad(() => api<SiteSettings>("GET", "/site"), []);
  const [form, setForm] = useState<SiteSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  useEffect(() => {
    if (data) setForm(data);
  }, [data]);
  if (!form) return <Loading error={error} />;
  const set = (key: keyof SiteSettings) => (event: { target: { value: string } }) => setForm({ ...form, [key]: event.target.value });

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      setForm(await api<SiteSettings>("PUT", "/site", form));
      toast.ok("Store details saved. Visitors see them within a few minutes.");
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Store details" actions={<span className="muted small">Shown to customers on every page</span>}>
      <form className="grid-2" onSubmit={save}>
        <Field label="Business name">
          <Input value={form.businessName} onChange={set("businessName")} required maxLength={80} />
        </Field>
        <Field label="Top banner" hint="The strip above the menu. Leave empty to hide it. Keep it true: it is a promise to customers.">
          <Input value={form.announcement} onChange={set("announcement")} maxLength={160} />
        </Field>
        <Field label="WhatsApp number" hint="Used for the “Message us” links. Local numbers like 024 555 0199 are fine.">
          <Input inputMode="tel" value={form.whatsapp} onChange={set("whatsapp")} />
        </Field>
        <Field label="Phone number" hint="Shown in the footer and on the contact page.">
          <Input inputMode="tel" value={form.phone} onChange={set("phone")} />
        </Field>
        <Field label="Email">
          <Input type="email" value={form.email} onChange={set("email")} />
        </Field>
        <Field label="Instagram" hint="A handle or a link.">
          <Input value={form.instagram} onChange={set("instagram")} />
        </Field>
        <Field label="Pickup address and hours" hint="Shown on Delivery & returns and Contact." wide>
          <Textarea rows={3} value={form.pickupNote} onChange={set("pickupNote")} maxLength={400} />
        </Field>
        <div className="form-actions grid-span">
          <Button type="submit" tone="primary" busy={busy}>
            Save details
          </Button>
        </div>
      </form>
    </Card>
  );
}

function Account() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const mismatch = confirm.length > 0 && confirm !== next;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (next !== confirm) return;
    setBusy(true);
    try {
      await changePassword(current, next);
      setCurrent("");
      setNext("");
      setConfirm("");
      toast.ok("Password changed. Other devices have been signed out.");
    } catch (err) {
      toast.error(new Error(authErrorText(err)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Your password">
      <form className="variant-add password-form" onSubmit={submit}>
        <Field label="Current password">
          <Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
        </Field>
        <Field label="New password" hint={`At least ${MIN_PASSWORD} characters.`}>
          <Input type="password" autoComplete="new-password" minLength={MIN_PASSWORD} value={next} onChange={(e) => setNext(e.target.value)} required />
        </Field>
        <Field label="Confirm new password" hint={mismatch ? "Passwords do not match." : undefined}>
          <Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required aria-invalid={mismatch} />
        </Field>
        <Button type="submit" tone="primary" busy={busy} disabled={mismatch}>
          Change password
        </Button>
      </form>
    </Card>
  );
}

function Team({ me }: { me: User }) {
  const { data, error, reload } = useLoad(() => api<{ items: TeamMember[] }>("GET", "/users"), []);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<User["role"]>("editor");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function add(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await api("POST", "/users", { email, name, role, password });
      setEmail("");
      setName("");
      setPassword("");
      setRole("editor");
      reload();
      toast.ok("Admin added. Share the password with them privately; they can change it in Settings.");
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  async function patch(member: TeamMember, body: Partial<Pick<TeamMember, "role" | "disabled">>) {
    try {
      await api("PATCH", `/users/${member.id}`, body);
      reload();
    } catch (err) {
      toast.error(err);
      reload();
    }
  }

  async function reset(member: TeamMember) {
    const value = prompt(`New password for ${member.email} (at least ${MIN_PASSWORD} characters). They will be signed out everywhere.`);
    if (!value) return;
    try {
      await api("POST", `/users/${member.id}/password`, { password: value });
      toast.ok("Password reset.");
    } catch (err) {
      toast.error(err);
    }
  }

  return (
    <Card title="Team" actions={<span className="muted small">Owners manage the team, delivery and activity; editors manage catalogue, content and orders.</span>}>
      {!data ? (
        <Loading error={error} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Admin</th>
                <th>Role</th>
                <th>Last sign-in</th>
                <th>Access</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.items.map((member) => {
                const self = member.id === me.id;
                return (
                  <tr key={member.id}>
                    <td>
                      <strong>{member.name}</strong> {self ? <Badge value="draft" label="you" /> : null}
                      <div className="muted small">{member.email}</div>
                    </td>
                    <td>
                      <Select value={member.role} disabled={self} onChange={(e) => patch(member, { role: e.target.value as User["role"] })} aria-label={`Role for ${member.email}`}>
                        <option value="owner">Owner</option>
                        <option value="editor">Editor</option>
                      </Select>
                    </td>
                    <td className="muted small">{member.lastLoginAt ? formatDate(member.lastLoginAt) : "Never"}</td>
                    <td>{member.disabled ? <Badge value="cancelled" label="disabled" /> : <Badge value="published" label="active" />}</td>
                    <td>
                      {self ? null : (
                        <div className="row-actions">
                          <button type="button" className="link-button" onClick={() => reset(member)}>
                            Reset password
                          </button>
                          <button type="button" className={`link-button ${member.disabled ? "" : "danger"}`} onClick={() => patch(member, { disabled: !member.disabled })}>
                            {member.disabled ? "Enable" : "Disable"}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <form className="variant-add team-form" onSubmit={add}>
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label="Email">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="off" />
        </Field>
        <Field label="Role">
          <Select value={role} onChange={(e) => setRole(e.target.value as User["role"])}>
            <option value="editor">Editor</option>
            <option value="owner">Owner</option>
          </Select>
        </Field>
        <Field label="Temporary password" hint={`At least ${MIN_PASSWORD} characters.`}>
          <Input type="password" autoComplete="new-password" minLength={MIN_PASSWORD} value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <Button type="submit" tone="primary" busy={busy}>
          Add admin
        </Button>
      </form>
    </Card>
  );
}

function Delivery({ owner }: { owner: boolean }) {
  const { data, error, reload } = useLoad(() => api<{ items: DeliveryOption[] }>("GET", "/delivery-options"), []);
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [price, setPrice] = useState("");
  const [method, setMethod] = useState<DeliveryOption["method"]>("delivery");
  const toast = useToast();

  async function add(event: FormEvent) {
    event.preventDefault();
    try {
      await api("POST", "/delivery-options", { code, label, priceMinor: toMinor(price), method, active: false });
      setCode("");
      setLabel("");
      setPrice("");
      setMethod("delivery");
      reload();
    } catch (err) {
      toast.error(err);
    }
  }

  async function patch(option: DeliveryOption, body: Partial<DeliveryOption>) {
    try {
      await api("PATCH", `/delivery-options/${option.id}`, body);
      reload();
    } catch (err) {
      toast.error(err);
    }
  }

  async function remove(option: DeliveryOption) {
    if (!confirm(`Delete ${option.label}?`)) return;
    try {
      await api("DELETE", `/delivery-options/${option.id}`);
      reload();
    } catch (err) {
      toast.error(err);
    }
  }

  return (
    <Card title="Delivery options">
      <Notice tone="warn">The delivery policy is not confirmed. Only activate options that reflect the agreed rules; active options are returned in checkout quotes. Customers choose between these at checkout: “Pickup” options need no address, “Delivery” options ask for one.</Notice>
      {!data ? (
        <Loading error={error} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Option</th>
                <th>Type</th>
                <th>Price</th>
                <th>Active</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.items.map((option) => (
                <tr key={option.id}>
                  <td>
                    <strong>{option.label}</strong>
                    <div className="mono small muted">{option.code}</div>
                  </td>
                  <td>
                    {owner ? (
                      <Select value={option.method} aria-label="Type" onChange={(e) => patch(option, { method: e.target.value as DeliveryOption["method"] })}>
                        <option value="delivery">Delivery</option>
                        <option value="pickup">Pickup</option>
                      </Select>
                    ) : (
                      humanize(option.method)
                    )}
                  </td>
                  <td>
                    {owner ? (
                      <Input
                        defaultValue={toCedis(option.priceMinor)}
                        inputMode="decimal"
                        aria-label="Price in GHS"
                        onBlur={(e) => toMinor(e.target.value) !== option.priceMinor && patch(option, { priceMinor: toMinor(e.target.value) })}
                      />
                    ) : (
                      formatMoney(option.priceMinor)
                    )}
                  </td>
                  <td>
                    <Checkbox checked={option.active} onChange={(value) => owner && patch(option, { active: value })} label={option.active ? "Active" : "Off"} />
                  </td>
                  <td>
                    {owner ? (
                      <button type="button" className="link-button danger" onClick={() => remove(option)}>
                        Delete
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {owner ? (
        <form className="variant-add" onSubmit={add}>
          <Field label="Code">
            <Input value={code} onChange={(e) => setCode(e.target.value.toLowerCase())} pattern="[a-z0-9-]{2,40}" required placeholder="accra-courier" />
          </Field>
          <Field label="Label">
            <Input value={label} onChange={(e) => setLabel(e.target.value)} required />
          </Field>
          <Field label="Type">
            <Select value={method} onChange={(e) => setMethod(e.target.value as DeliveryOption["method"])}>
              <option value="delivery">Delivery (asks for an address)</option>
              <option value="pickup">Pickup (no address)</option>
            </Select>
          </Field>
          <Field label="Price (GHS)">
            <Input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} required />
          </Field>
          <Button type="submit" tone="primary">
            Add (inactive)
          </Button>
        </form>
      ) : null}
    </Card>
  );
}

function Audit() {
  const { data, error } = useLoad(
    () => api<{ items: { action: string; entity: string; entityId: string | null; actor: string | null; createdAt: string }[] }>("GET", "/audit"),
    [],
  );
  return (
    <Card title="Recent activity">
      {!data ? (
        <Loading error={error} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>When</th>
                <th>Who</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((row, index) => (
                <tr key={index}>
                  <td className="muted small">{formatDate(row.createdAt)}</td>
                  <td>{row.actor ?? "—"}</td>
                  <td>
                    {row.action} <span className="muted">{row.entity}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
