import { useEffect, useState } from "react";
import { Button, Card, Field, Input, Notice } from "../components/ui";
import { ApiError, signIn } from "../lib/api";
import { deviceId } from "../lib/session";

export function SignIn({ onSignedIn, lastTenant }: { onSignedIn: (tenantCode: string, s: Awaited<ReturnType<typeof signIn>>) => void; lastTenant?: string }) {
  const [tenant, setTenant] = useState(lastTenant ?? "");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [mfa, setMfa] = useState<null | { mode: "required" | "enrol"; secret?: string }>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // On a tenant's own address (for example glazebrooke.oneuptech.co) the address decides the tenant.
  const [site, setSite] = useState<{ code: string; name: string } | null | undefined>(undefined);
  useEffect(() => {
    fetch("/api/v1/site")
      .then((r) => (r.ok ? r.json() : { tenant: null }))
      .then((b: { tenant: { code: string; name: string } | null }) => setSite(b.tenant))
      .catch(() => setSite(null));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await signIn({ ...(site ? {} : { tenant }), username, password, deviceId: await deviceId(), deviceLabel: navigator.userAgent.slice(0, 80), ...(mfa ? { totp } : {}) });
      if ("mfa" in res) setMfa({ mode: res.mfa, secret: res.secret });
      else onSignedIn(site?.code ?? tenant, res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Cannot reach the server. Check the internet connection.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 p-4">
      <div className="text-center">
        <img src="/icon.svg" alt="" className="mx-auto h-16 w-16" />
        <h1 className="mt-3">{site?.name ?? "CEMMS Estate"}</h1>
        <p className="text-muted">Attendance, weigh-in and daily log</p>
      </div>
      <Card>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          {site === null && (
            <Field label="Estate group code" htmlFor="tenant">
              <Input id="tenant" autoComplete="organization" autoCapitalize="none" value={tenant} onChange={(e) => setTenant(e.target.value.trim().toLowerCase())} required />
            </Field>
          )}
          <Field label="User name" htmlFor="username">
            <Input id="username" autoComplete="username" autoCapitalize="none" value={username} onChange={(e) => setUsername(e.target.value)} required />
          </Field>
          <Field label="Password" htmlFor="password">
            <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          {mfa && (
            <>
              {mfa.mode === "enrol" && (
                <Notice tone="info">
                  Your role needs a second sign-in step. Add this key to an authenticator app (for example Google Authenticator), then enter the 6-digit code.
                  <code className="mt-2 block break-all rounded bg-surface p-2 font-mono text-sm">{mfa.secret}</code>
                </Notice>
              )}
              <Field label="6-digit code" htmlFor="totp">
                <Input id="totp" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} value={totp} onChange={(e) => setTotp(e.target.value.replace(/\D/g, ""))} required />
              </Field>
            </>
          )}
          {error && <Notice tone="bad">{error}</Notice>}
          <Button type="submit" size="lg" disabled={busy || site === undefined || (site === null && !tenant) || !username || !password || (mfa !== null && totp.length !== 6)}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </Card>
      <p className="text-center text-xs text-muted">Sign in once with internet. After that you can keep working without signal until the session ends.</p>
    </main>
  );
}
