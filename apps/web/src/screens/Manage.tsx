import { IMPORT_KINDS, importTemplate } from "@cemms/domain";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useApp } from "../app-context";
import { Button, Card, Field, Input, Notice, Select } from "../components/ui";
import { ApiError, api } from "../lib/api";

const msg = (e: unknown) => (e instanceof ApiError ? e.message : "Could not reach the server.");

function Imports() {
  const app = useApp();
  const [kind, setKind] = useState<(typeof IMPORT_KINDS)[number]>("estates");
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<null | {
    previewHash: string;
    totals: Record<string, number>;
    rows: { row: number; key: string; action: string; changes: string[] }[];
    errors: { row: number; column: string; message: string }[];
  }>(null);
  const [note, setNote] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const order = "Import in this order: estates, varieties, job types, fields, workers.";
  return (
    <Card title="Import master lists (CSV)">
      <p className="mb-3 text-sm text-muted">{order} Download a template, fill it in a spreadsheet, save as CSV and choose it here. Nothing changes until you press Apply.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="List" htmlFor="imp-kind">
          <Select
            id="imp-kind"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as typeof kind);
              setPreview(null);
            }}
          >
            {IMPORT_KINDS.map((k) => (
              <option key={k} value={k}>
                {k.replace("_", " ")}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="CSV file" htmlFor="imp-file">
          <Input
            id="imp-file"
            type="file"
            accept=".csv,text/csv"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) {
                setCsv(await f.text());
                setPreview(null);
              }
            }}
          />
        </Field>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          variant="secondary"
          onClick={() => {
            setCsv(importTemplate(kind));
            setPreview(null);
          }}
        >
          Load template
        </Button>
        <Button
          disabled={!csv || !app.online}
          onClick={async () => {
            setNote(null);
            try {
              setPreview(await api(`/imports/preview`, { body: { kind, csv } }));
            } catch (e) {
              setNote({ tone: "bad", text: msg(e) });
            }
          }}
        >
          Check file
        </Button>
        {preview && preview.errors.length === 0 && (
          <Button
            onClick={async () => {
              try {
                const r = await api<{ alreadyImported: boolean; totals: Record<string, number> }>(`/imports/commit`, { body: { kind, csv, previewHash: preview.previewHash } });
                setNote({ tone: "ok", text: r.alreadyImported ? "This file was already imported. Nothing changed." : `Done: ${r.totals.create} added, ${r.totals.update} changed.` });
                setPreview(null);
                await app.reloadReference();
              } catch (e) {
                setNote({ tone: "bad", text: msg(e) });
              }
            }}
          >
            Apply
          </Button>
        )}
      </div>
      <textarea
        aria-label="CSV contents"
        className="mt-3 min-h-32 w-full rounded-xl border border-line bg-surface p-2 font-mono text-sm"
        value={csv}
        onChange={(e) => {
          setCsv(e.target.value);
          setPreview(null);
        }}
      />
      {note && <Notice tone={note.tone}>{note.text}</Notice>}
      {preview && (
        <div className="mt-3">
          <p className="font-semibold">
            {preview.totals.create} to add, {preview.totals.update} to change, {preview.totals.unchanged} unchanged, {preview.errors.length} problem(s)
          </p>
          {preview.errors.length > 0 && (
            <ul className="mt-2 text-sm text-bad">
              {preview.errors.map((e) => (
                <li key={`${e.row}${e.column}${e.message}`}>
                  Row {e.row}, {e.column}: {e.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}

const ROLE_LABEL: Record<string, string> = { OWNER: "Owner", ESTATE_MANAGER: "Estate manager", FIELD_SUPERVISOR: "Field supervisor", AUDITOR: "Auditor (read only)" };

/** A readable temporary password, shown once so the owner can pass it on. */
function tempPassword() {
  const words = ["coffee", "pepper", "estate", "harvest", "garden", "monsoon", "valley", "berry", "shade", "pulper"];
  const rand = (n: number) => (crypto.getRandomValues(new Uint32Array(1))[0] ?? 0) % n;
  const pick = () => words[rand(words.length)];
  return `${pick()}-${pick()}-${String(rand(10000)).padStart(4, "0")}`;
}

interface UserRow {
  id: string;
  username: string;
  displayName: string;
  status: string;
  mfaEnabled: boolean;
  lockedUntil: string | null;
  grants: { role: string; estateId: string | null }[];
}

function Users() {
  const app = useApp();
  const qc = useQueryClient();
  const users = useQuery({ queryKey: ["users"], queryFn: () => api<UserRow[]>("/admin/users"), enabled: app.online });
  const estates = app.ref?.estates ?? [];
  const blank = { username: "", displayName: "", password: tempPassword(), role: "FIELD_SUPERVISOR", allEstates: true, estateIds: [] as string[] };
  const [form, setForm] = useState(blank);
  const [note, setNote] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const estateName = (id: string | null) => (id ? (estates.find((e) => e.id === id)?.name ?? "estate") : "all estates");
  const describe = (u: UserRow) => {
    const byRole = new Map<string, (string | null)[]>();
    for (const g of u.grants) byRole.set(g.role, [...(byRole.get(g.role) ?? []), g.estateId]);
    return [...byRole].map(([role, ids]) => `${ROLE_LABEL[role] ?? role} · ${ids.map(estateName).join(", ")}`).join("; ");
  };
  const refresh = () => qc.invalidateQueries({ queryKey: ["users"] });

  async function add() {
    setNote(null);
    const owner = form.role === "OWNER";
    const grants = owner || form.allEstates ? [{ role: form.role, estateId: null }] : form.estateIds.map((estateId) => ({ role: form.role, estateId }));
    if (grants.length === 0) return setNote({ tone: "bad", text: "Choose at least one estate." });
    try {
      await api("/admin/users", { body: { username: form.username, displayName: form.displayName, password: form.password, grants } });
      setNote({
        tone: "ok",
        text: `Added ${form.username}. Temporary password: ${form.password} (they choose their own at first sign-in${owner ? "; in production they also set up an authenticator app" : ""}).`,
      });
      setForm({ ...blank, password: tempPassword() });
      void refresh();
    } catch (e) {
      setNote({ tone: "bad", text: msg(e) });
    }
  }

  async function resetPassword(u: UserRow) {
    const password = tempPassword();
    if (!window.confirm(`Give ${u.displayName} a new temporary password? They will be signed out everywhere and must choose their own at next sign-in.`)) return;
    try {
      await api(`/admin/users/${u.id}/password`, { body: { password } });
      setNote({ tone: "ok", text: `New temporary password for ${u.username}: ${password}` });
      void refresh();
    } catch (e) {
      setNote({ tone: "bad", text: msg(e) });
    }
  }

  async function disable(u: UserRow) {
    const reason = window.prompt(`Why disable ${u.displayName}?`);
    if (!reason || reason.trim().length < 3) return;
    try {
      await api(`/admin/users/${u.id}/disable`, { body: { reason: reason.trim() } });
      setNote({ tone: "ok", text: `${u.username} is disabled and signed out.` });
      void refresh();
    } catch (e) {
      setNote({ tone: "bad", text: msg(e) });
    }
  }

  return (
    <>
      <Card title="Users">
        {note && <Notice tone={note.tone}>{note.text}</Notice>}
        <ul className="mt-2 divide-y divide-line">
          {(users.data ?? []).map((u) => (
            <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div className="min-w-0">
                <p className="font-semibold">
                  {u.displayName} <span className="font-normal text-muted">({u.username})</span>
                </p>
                <p className="text-sm text-muted">
                  {describe(u)}
                  {u.status !== "ACTIVE" ? " · disabled" : ""}
                  {u.lockedUntil && new Date(u.lockedUntil) > new Date() ? " · locked after wrong passwords" : ""}
                </p>
              </div>
              {u.status === "ACTIVE" && u.id !== app.session.user.id && (
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => resetPassword(u)}>
                    New password
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => disable(u)}>
                    Disable
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </Card>
      <Card title="Add a user">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="User name" htmlFor="u-name" hint="Lower case, for example manager">
            <Input id="u-name" autoCapitalize="none" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value.trim().toLowerCase() })} />
          </Field>
          <Field label="Full name" htmlFor="u-display">
            <Input id="u-display" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
          </Field>
          <Field label="Temporary password" htmlFor="u-pass" hint="They choose their own at first sign-in">
            <div className="flex gap-2">
              <Input id="u-pass" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
              <Button variant="secondary" onClick={() => setForm({ ...form, password: tempPassword() })}>
                New
              </Button>
            </div>
          </Field>
          <Field label="Role" htmlFor="u-role" hint={form.role === "OWNER" ? "In production the owner also uses an authenticator app" : undefined}>
            <Select id="u-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="FIELD_SUPERVISOR">Field supervisor: attendance, weigh-in, daily log</option>
              <option value="ESTATE_MANAGER">Estate manager: also approvals, corrections, lists</option>
              <option value="OWNER">Owner: everything, including users and settings</option>
              <option value="AUDITOR">Auditor: read only</option>
            </Select>
          </Field>
        </div>
        {form.role !== "OWNER" && (
          <fieldset className="mt-3">
            <legend className="text-sm font-semibold">Estates</legend>
            <label className="mt-1 flex min-h-11 items-center gap-2">
              <input type="checkbox" checked={form.allEstates} onChange={(e) => setForm({ ...form, allEstates: e.target.checked })} /> All estates
            </label>
            {!form.allEstates &&
              estates.map((e) => (
                <label key={e.id} className="flex min-h-11 items-center gap-2">
                  <input
                    type="checkbox"
                    checked={form.estateIds.includes(e.id)}
                    onChange={(ev) => setForm({ ...form, estateIds: ev.target.checked ? [...form.estateIds, e.id] : form.estateIds.filter((x) => x !== e.id) })}
                  />{" "}
                  {e.name}
                </label>
              ))}
          </fieldset>
        )}
        <Button className="mt-3" disabled={!app.online || form.password.length < 12 || !/^[a-z0-9._-]{2,60}$/.test(form.username) || !form.displayName.trim()} onClick={add}>
          Add user
        </Button>
      </Card>
    </>
  );
}

function Conflicts() {
  const app = useApp();
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ["conflicts", app.estateId],
    queryFn: () => api<{ id: string; incoming: Record<string, string>; server: Record<string, string>; createdAt: string }[]>(`/estates/${app.estateId}/conflicts`),
    enabled: app.online && app.can("conflicts.resolve"),
  });
  const [reason, setReason] = useState<Record<string, string>>({});
  const name = (id: string) => app.ref?.workers.find((w) => w.id === id)?.name ?? "worker";
  const describe = (r: Record<string, string>) =>
    r.statusCode === "PRESENT" ? `${r.dayFraction === "HALF" ? "Half day" : "Full day"}, ${app.ref?.fields.find((f) => f.id === r.fieldId)?.name ?? "?"}` : r.statusCode?.toLowerCase();
  return (
    <Card title="Conflicts (same worker marked twice)">
      {(list.data ?? []).length === 0 && <p className="text-muted">No conflicts.</p>}
      <ul className="flex flex-col gap-3">
        {(list.data ?? []).map((c) => (
          <li key={c.id} className="rounded-xl border border-line p-3">
            <p className="font-semibold">
              {name(c.server.workerId ?? "")} · {c.server.businessDate}
            </p>
            <p className="text-sm">On the server: {describe(c.server)}</p>
            <p className="text-sm">From the other phone: {describe(c.incoming)}</p>
            <Input aria-label="Reason" className="mt-2" placeholder="Reason for your choice" value={reason[c.id] ?? ""} onChange={(e) => setReason({ ...reason, [c.id]: e.target.value })} />
            <div className="mt-2 flex gap-2">
              {(["server", "incoming"] as const).map((keep) => (
                <Button
                  key={keep}
                  variant="secondary"
                  disabled={(reason[c.id] ?? "").trim().length < 3}
                  onClick={async () => {
                    await api(`/conflicts/${c.id}/resolve`, { body: { keep, reason: reason[c.id] } });
                    void qc.invalidateQueries({ queryKey: ["conflicts"] });
                  }}
                >
                  Keep {keep === "server" ? "server entry" : "other phone's entry"}
                </Button>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

const TYPE_LABEL: Record<string, string> = { PRESENT: "Present (full or half day)", ABSENT: "Absent", LEAVE: "Leave", OFF_DAY: "Off day", HOLIDAY: "Holiday" };

/** Which attendance types the register offers. Leave, Off day and Holiday wait for the owner's answer (OC-8). */
function AttendanceTypes() {
  const app = useApp();
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api<{ key: string; value: unknown; gates: { id: string; status: string }[] }[]>("/admin/settings"), enabled: app.online });
  const entry = settings.data?.find((x) => x.key === "attendance.statuses.enabled");
  const enabled = (entry?.value as string[] | undefined) ?? ["PRESENT", "ABSENT"];
  const [note, setNote] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const toggle = async (code: string, on: boolean) => {
    const next = Object.keys(TYPE_LABEL).filter((c) => (c === code ? on : enabled.includes(c)));
    try {
      await api("/admin/settings/attendance.statuses.enabled", { method: "PUT", body: { value: next } });
      setNote({ tone: "ok", text: "Saved. The register now offers these types." });
      await qc.invalidateQueries({ queryKey: ["settings"] });
      await qc.invalidateQueries({ queryKey: ["sheet"] });
    } catch (e) {
      setNote({ tone: "bad", text: msg(e) });
    }
  };
  return (
    <Card title="Attendance types">
      <p className="mb-2 text-sm text-muted">
        The owner has not yet said which attendance types the estate uses (question OC-8). Present and Absent are on. Leave, Off day and Holiday can be switched on to try them here; the live site
        refuses to switch them on until the owner confirms.
      </p>
      <ul>
        {Object.entries(TYPE_LABEL).map(([code, label]) => (
          <li key={code}>
            <label className="flex min-h-11 items-center gap-2">
              <input
                type="checkbox"
                checked={enabled.includes(code)}
                disabled={code === "PRESENT" || code === "ABSENT" || !app.can("settings.manage", null)}
                onChange={(e) => toggle(code, e.target.checked)}
              />{" "}
              {label}
            </label>
          </li>
        ))}
      </ul>
      {note && <Notice tone={note.tone}>{note.text}</Notice>}
    </Card>
  );
}

function Setup() {
  const app = useApp();
  const qc = useQueryClient();
  const readiness = useQuery({
    queryKey: ["readiness"],
    queryFn: () => api<{ ready: boolean; blocking: { id: string; question: string; interimBehavior: string }[] }>("/admin/readiness"),
    enabled: app.online && app.can("settings.manage", null),
  });
  const [kind, setKind] = useState({ code: "", label: "", unit: "", valueType: "NUMBER", decimals: "1" });
  const [note, setNote] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  return (
    <>
      <AttendanceTypes />
      <Card title="Daily log types">
        <p className="mb-2 text-sm text-muted">Which readings to take is still to be confirmed with the owner (question OC-100). Add only the readings the estate has agreed.</p>
        <ul className="mb-3 text-sm">
          {(app.ref?.logKinds ?? []).map((k) => (
            <li key={k.id}>
              {k.label} {k.unit ? `(${k.unit})` : ""}
            </li>
          ))}
        </ul>
        <div className="grid gap-3 sm:grid-cols-5">
          <Input aria-label="Code" placeholder="Code" value={kind.code} onChange={(e) => setKind({ ...kind, code: e.target.value })} />
          <Input aria-label="Name" placeholder="Name, e.g. Rain" value={kind.label} onChange={(e) => setKind({ ...kind, label: e.target.value })} />
          <Input aria-label="Unit" placeholder="Unit, e.g. mm" value={kind.unit} onChange={(e) => setKind({ ...kind, unit: e.target.value })} />
          <Select aria-label="Type" value={kind.valueType} onChange={(e) => setKind({ ...kind, valueType: e.target.value })}>
            <option value="NUMBER">Number</option>
            <option value="TEXT">Text</option>
          </Select>
          <Select aria-label="Decimals" value={kind.decimals} onChange={(e) => setKind({ ...kind, decimals: e.target.value })}>
            {["0", "1", "2", "3"].map((d) => (
              <option key={d} value={d}>
                {d} decimals
              </option>
            ))}
          </Select>
        </div>
        {note && <Notice tone={note.tone}>{note.text}</Notice>}
        <Button
          className="mt-3"
          disabled={!kind.code || !kind.label || !app.online}
          onClick={async () => {
            try {
              await api("/admin/log-kinds", {
                body: { code: kind.code, label: kind.label, unit: kind.unit || null, valueType: kind.valueType, decimals: Number(kind.decimals), minScaled: null, maxScaled: null },
              });
              setNote({ tone: "ok", text: "Reading type added." });
              setKind({ code: "", label: "", unit: "", valueType: "NUMBER", decimals: "1" });
              await app.reloadReference();
            } catch (e) {
              setNote({ tone: "bad", text: msg(e) });
            }
          }}
        >
          Add reading type
        </Button>
      </Card>
      <Card title="Go-live readiness">
        {readiness.data?.ready ? (
          <Notice tone="ok">No open owner questions block Phase 1A.</Notice>
        ) : (
          <>
            <p className="mb-2 text-sm">These owner questions are still open. Until they are answered the app uses the safe interim behaviour shown.</p>
            <ul className="flex flex-col gap-2 text-sm">
              {(readiness.data?.blocking ?? []).map((g) => (
                <li key={g.id} className="rounded-xl bg-bg p-2">
                  <strong>{g.id}</strong> {g.question}
                  <br />
                  <span className="text-muted">Now: {g.interimBehavior}</span>
                </li>
              ))}
            </ul>
            <Button size="sm" variant="ghost" onClick={() => qc.invalidateQueries({ queryKey: ["readiness"] })}>
              Refresh
            </Button>
          </>
        )}
      </Card>
    </>
  );
}

export function Manage() {
  const app = useApp();
  const [tab, setTab] = useState<"import" | "users" | "conflicts" | "setup">("import");
  if (!app.online) return <Notice tone="warn">Managing lists and users needs signal.</Notice>;
  const tabs = [
    { id: "import", label: "Import", show: app.can("masters.import", null) || app.can("masters.import") },
    { id: "users", label: "Users", show: app.can("users.manage", null) },
    { id: "conflicts", label: "Conflicts", show: app.can("conflicts.resolve") },
    { id: "setup", label: "Setup", show: app.can("settings.manage", null) },
  ] as const;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2" role="tablist">
        {tabs
          .filter((t) => t.show)
          .map((t) => (
            <Button key={t.id} role="tab" aria-selected={tab === t.id} variant={tab === t.id ? "primary" : "secondary"} size="sm" onClick={() => setTab(t.id)}>
              {t.label}
            </Button>
          ))}
      </div>
      {tab === "import" && <Imports />}
      {tab === "users" && <Users />}
      {tab === "conflicts" && <Conflicts />}
      {tab === "setup" && <Setup />}
    </div>
  );
}
