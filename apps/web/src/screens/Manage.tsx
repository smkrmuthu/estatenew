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

function Users() {
  const app = useApp();
  const qc = useQueryClient();
  const users = useQuery({
    queryKey: ["users"],
    queryFn: () => api<{ id: string; username: string; displayName: string; status: string; grants: { role: string; estateId: string | null }[] }[]>("/admin/users"),
    enabled: app.online,
  });
  const [form, setForm] = useState({ username: "", displayName: "", password: "", role: "FIELD_SUPERVISOR", estateId: app.estateId });
  const [note, setNote] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const estates = app.ref?.estates ?? [];
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });
  return (
    <Card title="Users">
      <ul className="mb-3 divide-y divide-line">
        {(users.data ?? []).map((u) => (
          <li key={u.id} className="py-2">
            <span className="font-semibold">{u.displayName}</span>{" "}
            <span className="text-muted">
              ({u.username}){u.status !== "ACTIVE" ? " · disabled" : ""}
            </span>
            <p className="text-sm text-muted">
              {u.grants.map((g) => `${g.role.replace("_", " ").toLowerCase()} · ${g.estateId ? (estates.find((e) => e.id === g.estateId)?.name ?? "estate") : "all estates"}`).join("; ")}
            </p>
          </li>
        ))}
      </ul>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="User name" htmlFor="u-name">
          <Input id="u-name" autoCapitalize="none" value={form.username} onChange={set("username")} />
        </Field>
        <Field label="Full name" htmlFor="u-display">
          <Input id="u-display" value={form.displayName} onChange={set("displayName")} />
        </Field>
        <Field label="First password (they change it)" htmlFor="u-pass" hint="At least 12 characters">
          <Input id="u-pass" type="password" autoComplete="new-password" value={form.password} onChange={set("password")} />
        </Field>
        <Field label="Role" htmlFor="u-role">
          <Select id="u-role" value={form.role} onChange={set("role")}>
            <option value="FIELD_SUPERVISOR">Field supervisor</option>
            <option value="ESTATE_MANAGER">Estate manager (needs authenticator app)</option>
            <option value="AUDITOR">Auditor (read only)</option>
          </Select>
        </Field>
        <Field label="Estate" htmlFor="u-estate">
          <Select id="u-estate" value={form.estateId} onChange={set("estateId")}>
            {estates.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {note && <Notice tone={note.tone}>{note.text}</Notice>}
      <Button
        className="mt-3"
        disabled={!app.online || form.password.length < 12 || !form.username || !form.displayName}
        onClick={async () => {
          try {
            await api("/admin/users", { body: { username: form.username, displayName: form.displayName, password: form.password, grants: [{ role: form.role, estateId: form.estateId }] } });
            setNote({ tone: "ok", text: "User added." });
            setForm({ ...form, username: "", displayName: "", password: "" });
            void qc.invalidateQueries({ queryKey: ["users"] });
          } catch (e) {
            setNote({ tone: "bad", text: msg(e) });
          }
        }}
      >
        Add user
      </Button>
    </Card>
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
