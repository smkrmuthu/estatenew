import { IMPORT_KINDS, importTemplate } from "@cemms/domain";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useApp } from "../app-context";
import { Button, Card, Chip, Field, Input, Notice, Select } from "../components/ui";
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
                disabled={code === "PRESENT" || code === "ABSENT" || !app.canAny("settings.configure")}
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

function SeasonStart() {
  const app = useApp();
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api<{ key: string; value: unknown }[]>("/admin/settings"), enabled: app.online });
  const current = (settings.data?.find((x) => x.key === "season.startDate")?.value as string | undefined) ?? "";
  const [value, setValue] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const shown = value ?? current;
  return (
    <Card title="Season">
      <p className="mb-2 text-sm text-muted">
        The first day of the plucking season. The dashboard adds up coffee from this day and compares it with the expected cherry entered on the fields. The owner has not yet confirmed the season
        dates (question OC-75), so the live site refuses to set this until they do.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Season start" htmlFor="season-start" hint="Leave blank for no season totals">
          <Input id="season-start" type="date" value={shown} onChange={(e) => setValue(e.target.value)} />
        </Field>
        <Button
          disabled={!app.online || shown === current}
          onClick={async () => {
            try {
              await api("/admin/settings/season.startDate", { method: "PUT", body: { value: shown } });
              setNote({ tone: "ok", text: shown ? "Saved. The dashboard now shows the season total." : "Cleared. The dashboard no longer shows a season total." });
              setValue(null);
              await qc.invalidateQueries({ queryKey: ["settings"] });
              await qc.invalidateQueries({ queryKey: ["dashboard"] });
              await qc.invalidateQueries({ queryKey: ["season"] });
            } catch (e) {
              setNote({ tone: "bad", text: msg(e) });
            }
          }}
        >
          Save
        </Button>
      </div>
      {note && (
        <div className="mt-3">
          <Notice tone={note.tone}>{note.text}</Notice>
        </div>
      )}
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
  return (
    <>
      <SeasonStart />
      <AttendanceTypes />
      {app.can("settings.manage", null) && (
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
      )}
    </>
  );
}

interface BackupRow {
  key: string;
  at: string;
  trigger: "nightly" | "manual";
  bytes: number;
  verified: boolean;
  tables: Record<string, number>;
  offsite?: { ok: boolean; error?: string };
}

function Backups() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["backups"], queryFn: () => api<{ backups: BackupRow[]; ageHours: number | null; late: boolean; schedule: string; googleDrive: boolean }>("/admin/backups") });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  async function backUpNow() {
    setBusy(true);
    setNote(null);
    try {
      await api("/admin/backups/run", { method: "POST", body: {} });
      setNote({ tone: "ok", text: "Backup finished and checked." });
      await qc.invalidateQueries({ queryKey: ["backups"] });
    } catch (e) {
      setNote({ tone: "bad", text: msg(e) });
    } finally {
      setBusy(false);
    }
  }
  const d = q.data;
  return (
    <Card
      title="Backups"
      actions={
        <Button onClick={backUpNow} disabled={busy}>
          {busy ? "Backing up…" : "Back up now"}
        </Button>
      }
    >
      <p className="mb-3 max-w-2xl text-sm text-muted">
        {d?.schedule ?? "Every night"} the office makes an encrypted copy of all your estates' data, reads it back and checks it. Copies are kept in addition to the 30-day restore. Entries still
        waiting on a phone are not in a copy until the phone syncs.
      </p>
      {q.isLoading && <p>Loading…</p>}
      {q.error && <Notice tone="bad">Could not load the backups.</Notice>}
      {d && (
        <Notice tone={d.late ? "warn" : "info"}>
          {d.ageHours === null
            ? "There is no backup yet. Press Back up now."
            : d.late
              ? `The last good backup is ${Math.round(d.ageHours)} hours old. Press Back up now and tell the office if this keeps happening.`
              : `Last good backup: ${d.ageHours} hours ago.`}
        </Notice>
      )}
      {d && !d.googleDrive && (
        <div className="mt-3">
          <Notice tone="warn">The second copy in Google Drive is not set up yet, so the backups are only in Cloudflare. Ask the office to finish the Google Drive setup.</Notice>
        </div>
      )}
      {d?.googleDrive && d.backups[0] && d.backups[0].offsite?.ok !== true && (
        <div className="mt-3">
          <Notice tone="warn">The newest backup was not copied to Google Drive{d.backups[0].offsite?.error ? `: ${d.backups[0].offsite.error}` : "."}</Notice>
        </div>
      )}
      {note && (
        <div className="mt-3">
          <Notice tone={note.tone}>{note.text}</Notice>
        </div>
      )}
      {d && d.backups.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[34rem] text-sm">
            <thead className="border-b border-line">
              <tr>
                {["Made", "How", "Workers", "Attendance", "Weigh-ins", "Size", "Checked", "Google Drive"].map((h) => (
                  <th key={h} className="px-3 py-2 text-left text-[0.8rem] font-medium text-muted">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {d.backups.map((b) => (
                <tr key={b.key}>
                  <td className="px-3 py-2 tabular-nums">{new Date(b.at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false })}</td>
                  <td className="px-3 py-2">{b.trigger === "nightly" ? "Nightly" : "On request"}</td>
                  <td className="px-3 py-2 tabular-nums">{b.tables.workers ?? 0}</td>
                  <td className="px-3 py-2 tabular-nums">{b.tables.attendance_records ?? 0}</td>
                  <td className="px-3 py-2 tabular-nums">{b.tables.muster_entries ?? 0}</td>
                  <td className="px-3 py-2 tabular-nums">{Math.max(1, Math.round(b.bytes / 1024))} KB</td>
                  <td className="px-3 py-2">{b.verified ? <Chip tone="ok">Checked</Chip> : <Chip tone="bad">Not checked</Chip>}</td>
                  <td className="px-3 py-2">{b.offsite ? b.offsite.ok ? <Chip tone="ok">Copied</Chip> : <Chip tone="bad">Failed</Chip> : <span className="text-muted">Not set up</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export function Manage() {
  const app = useApp();
  const [tab, setTab] = useState<"import" | "conflicts" | "setup" | "backups">("import");
  if (!app.online) return <Notice tone="warn">Managing lists and users needs signal.</Notice>;
  const tabs = [
    { id: "import", label: "Import", show: app.canAny("masters.import") },
    { id: "conflicts", label: "Conflicts", show: app.can("conflicts.resolve") },
    { id: "setup", label: "Setup", show: app.canAny("settings.configure") },
    { id: "backups", label: "Backups", show: app.isOwner },
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
      {tab === "conflicts" && <Conflicts />}
      {tab === "setup" && <Setup />}
      {tab === "backups" && <Backups />}
    </div>
  );
}
