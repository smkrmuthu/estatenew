import { useState } from "react";
import { Button, Card, Field, Input, Notice } from "../components/ui";
import { ApiError, api } from "../lib/api";

/** Used when an account is new or its password was reset (required), and from the account menu. */
export function ChangePassword({ required, onDone, onCancel }: { required: boolean; onDone: () => void; onCancel?: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mismatch = confirm.length > 0 && next !== confirm;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api("/auth/password", { body: { currentPassword: current, newPassword: next } });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? (err.fieldErrors ? (Object.values(err.fieldErrors)[0] ?? err.message) : err.message) : "Cannot reach the server. Changing a password needs signal.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 p-4">
      <Card title={required ? "Choose your own password" : "Change password"}>
        {required && <Notice tone="info">This account has a temporary password. Choose your own before you continue.</Notice>}
        <form onSubmit={submit} className="mt-3 flex flex-col gap-4" noValidate>
          <Field label={required ? "Temporary password" : "Current password"} htmlFor="pw-current">
            <Input id="pw-current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          </Field>
          <Field label="New password" htmlFor="pw-new" hint="At least 12 characters. A short sentence is easy to remember.">
            <Input id="pw-new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
          </Field>
          <Field label="New password again" htmlFor="pw-confirm" error={mismatch ? "The two new passwords are different" : undefined}>
            <Input id="pw-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Field>
          {error && <Notice tone="bad">{error}</Notice>}
          <div className="flex gap-2">
            <Button type="submit" size="lg" disabled={busy || !current || next.length < 12 || next !== confirm}>
              {busy ? "Saving…" : "Save password"}
            </Button>
            {onCancel && (
              <Button variant="secondary" size="lg" onClick={onCancel}>
                Cancel
              </Button>
            )}
          </div>
        </form>
      </Card>
    </main>
  );
}
