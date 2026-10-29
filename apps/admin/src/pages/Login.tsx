import { useState, type FormEvent } from "react";
import { authErrorText, signIn } from "../auth.ts";
import { Button, Field, Input } from "../components/ui.tsx";

// Signing in hands control back to App, which checks the account with the API.
export function Login({ notice }: { notice?: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await signIn(email.trim(), password);
    } catch (err) {
      setError(authErrorText(err));
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <img src="/esspor-coffee.svg" alt="Esspor" className="login-logo" />
        <h1>Sign in to Esspor Admin</h1>
        <p className="subtitle">Catalogue, orders and content.</p>
        <Field label="Email">
          <Input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </Field>
        <Field label="Password">
          <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {notice && !error ? (
          <p className="form-error" role="alert">
            {notice}
          </p>
        ) : null}
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <Button type="submit" tone="primary" busy={busy} className="full">
          Sign in
        </Button>
      </form>
    </div>
  );
}
