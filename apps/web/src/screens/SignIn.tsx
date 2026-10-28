import { useEffect, useState } from "react";
import { Button, Field, Input, Notice } from "../components/ui";
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

  const glazebrooke = site?.code === "glazebrooke";
  const estateName = site?.name ?? "your estate";
  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      {/* Hero like the prototype: the estate photo under a dark wash, the logo and one line about what the app is for. */}
      <section className="relative min-h-72 flex-1 overflow-hidden bg-[#2b1b0f] lg:basis-1/2">
        {glazebrooke && <img src="/hero.jpg" alt="Misty mountain ridges above the coffee estate" className="absolute inset-0 h-full w-full object-cover" />}
        <div className="absolute inset-0 bg-[rgba(32,20,10,0.58)]" />
        <div className="relative flex h-full min-h-72 flex-col justify-between gap-10 p-7 sm:p-10 lg:p-12">
          {glazebrooke ? <img src="/logo.png" alt="Glazebrooke Coffee Estate" className="w-48" /> : <p className="font-serif text-2xl font-semibold text-white">{site?.name ?? "CEMMS Estate"}</p>}
          <div>
            {glazebrooke && <p className="max-w-md font-serif text-3xl leading-tight text-white">Where bisons roam and birds soar, our coffee finds its soul.</p>}
            <p className="mt-3 max-w-md leading-relaxed text-[#f3ece0]">Attendance, plucking and the daily log for {estateName}, in one place.</p>
            <p className="mt-6 text-sm text-[#f3ece0]/80">
              Powered by{" "}
              <a href="https://oneuptech.co" target="_blank" rel="noopener noreferrer" className="font-medium text-white underline-offset-2 hover:underline">
                OneUp Tech
              </a>
            </p>
          </div>
        </div>
      </section>

      <section className="flex flex-1 items-center justify-center p-6 sm:p-10 lg:basis-1/2">
        <form onSubmit={submit} className="flex w-full max-w-sm flex-col gap-4" noValidate>
          <div>
            <span className="text-xs font-medium text-muted">CEMMS</span>
            <h1 className="mt-1.5 text-[2.1rem]">Sign in</h1>
            <p className="mt-1 text-muted">You will see the screens that your role allows.</p>
          </div>
          {site === null && (
            <Field label="Estate group code" htmlFor="tenant">
              <Input id="tenant" autoComplete="organization" autoCapitalize="none" value={tenant} onChange={(e) => setTenant(e.target.value.trim().toLowerCase())} required />
            </Field>
          )}
          <Field label="Username" htmlFor="username">
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
          <Button type="submit" size="lg" className="min-h-12" disabled={busy || site === undefined || (site === null && !tenant) || !username || !password || (mfa !== null && totp.length !== 6)}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
          <p className="border-t border-line pt-4 text-sm text-muted">Sign in once with internet. After that you can keep working without signal until the session ends.</p>
        </form>
      </section>
    </div>
  );
}
