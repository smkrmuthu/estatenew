import { addDays } from "@cemms/domain";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useApp } from "../app-context";
import { Button, Card, Field, FilterBar, FilterSearch, FilterSelect, Input, Notice } from "../components/ui";
import { ApiError, api, apiFile } from "../lib/api";
import { useCrops } from "../lib/crops";
import { useDashboards } from "./Dashboard";

interface Summary {
  estate: { id: string; name: string };
  attendance: {
    sheetState: string;
    night: { sheetState: string; present: number; bothShifts: number };
    marked: number;
    activeWorkers: number;
    present: number;
    halfDayCount: number;
    absent: number;
    manDays: string;
    byFieldJob: { field: string; job: string; workers: number; manDays: string }[];
  };
  weighIn: { byCrop: { crop: string; entries: number; workers: number; netKg: string }[]; byCropField: { crop: string; field: string; netKg: string }[]; workersWithSeveralEntries: number };
  dailyLog: { kind: string; unit: string | null; readingAt: string; value: string }[];
  sync: { openConflicts: number; devicesWaiting: number; entriesWaitingOnDevices: number; lastDeviceSyncAt: string | null; note: string };
}

interface Plucking {
  from: string;
  to: string;
  totals: { entries: number; coffeeNetKg: string; pepperNetKg: string };
  byField: { fieldId: string; field: string; entries: number; workerDays: number; coffeeNetKg: string; pepperNetKg: string; coffeeNetG: number; coffeePerWorkerDayKg: string }[];
  byWorker: { workerId: string; worker: string; employeeCode: string; days: number; entries: number; coffeeNetKg: string; pepperNetKg: string; coffeeNetG: number; bestDayKg: string }[] | null;
}

const STATE_TEXT: Record<string, string> = { NOT_STARTED: "not started", DRAFT: "draft", SUBMITTED: "submitted", APPROVED: "approved" };
const cropText = (c: string) => (c === "PEPPER" ? "Pepper" : "Coffee");
const dayText = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
const timeText = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** The message for one day, ready to paste into WhatsApp. Counts only what the server has received. */
/** Night is shown beside Day, never added to it; "both shifts" counts people who worked Day and Night. */
function nightLine(n: Summary["attendance"]["night"]): string {
  return `Night: ${n.present} present${n.bothShifts ? ` · ${n.bothShifts} also worked the day shift` : ""} (${(STATE_TEXT[n.sheetState] ?? n.sheetState).replace("_", " ")})`;
}

function whatsappMessage(date: string, list: Summary[], pepper: boolean): string {
  const lines: string[] = [`*Estate summary · ${dayText(date)}*`];
  for (const s of list) {
    lines.push("", `*${s.estate.name}*`);
    const a = s.attendance;
    lines.push(
      a.sheetState === "NOT_STARTED"
        ? "Attendance: not started"
        : `Attendance: ${a.present} present${a.halfDayCount ? ` (${a.halfDayCount} half day)` : ""}, ${a.absent} absent, ${a.marked} of ${a.activeWorkers} marked · ${a.manDays} man-days (${STATE_TEXT[a.sheetState] ?? a.sheetState})`,
    );
    if (a.night.sheetState !== "NOT_STARTED") lines.push(nightLine(a.night));
    const crops = s.weighIn.byCrop.filter((c) => pepper || c.crop !== "PEPPER");
    if (crops.length === 0) lines.push("Plucking: no weigh-ins yet");
    for (const c of crops) lines.push(`${cropText(c.crop)}: ${c.netKg} kg from ${c.workers} ${c.workers === 1 ? "worker" : "workers"} (${c.entries} ${c.entries === 1 ? "weigh-in" : "weigh-ins"})`);
    if (s.dailyLog.length) lines.push(`Daily log: ${s.dailyLog.map((r) => `${r.kind} ${r.value}${r.unit ? ` ${r.unit}` : ""} (${timeText(r.readingAt)})`).join("; ")}`);
  }
  const waiting = list.reduce((n, s) => n + s.sync.entriesWaitingOnDevices, 0);
  if (waiting) lines.push("", `Note: ${waiting} entries are still on supervisor phones and are not counted yet.`);
  return lines.join("\n");
}

function Bar({ value, max }: { value: number; max: number }) {
  return (
    <span className="block h-1.5 w-28 overflow-hidden rounded-full bg-surface-2">
      <span className="block h-full rounded-full bg-roast" style={{ width: `${max > 0 ? Math.round((value / max) * 100) : 0}%` }} />
    </span>
  );
}

const Th = ({ children, right }: { children?: React.ReactNode; right?: boolean }) => (
  <th className={`px-3 py-2 text-[0.8rem] font-medium text-muted ${right ? "text-right" : "text-left"}`}>{children}</th>
);

function DaySummary({ s }: { s: Summary }) {
  const { pepper } = useCrops();
  const byCrop = s.weighIn.byCrop.filter((c) => pepper || c.crop !== "PEPPER");
  return (
    <div className="grid items-start gap-4 xl:grid-cols-[3fr_2fr]">
      <Card title={`Attendance · ${s.estate.name}`}>
        <p>
          {s.attendance.present} present ({s.attendance.halfDayCount} half day), {s.attendance.absent} absent, {s.attendance.marked} of {s.attendance.activeWorkers} marked · {s.attendance.manDays}{" "}
          man-days · {(STATE_TEXT[s.attendance.sheetState] ?? s.attendance.sheetState).replace("_", " ")}
        </p>
        {s.attendance.night.sheetState !== "NOT_STARTED" && <p className="mt-1 text-sm text-muted">{nightLine(s.attendance.night)}</p>}
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[22rem] text-left text-sm">
            <thead className="border-b border-line">
              <tr>
                <Th>Field</Th>
                <Th>Job</Th>
                <Th right>Workers</Th>
                <Th right>Man-days</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {s.attendance.byFieldJob.map((r) => (
                <tr key={`${r.field}${r.job}`}>
                  <td className="px-3 py-1.5">{r.field}</td>
                  <td className="px-3 py-1.5">{r.job}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{r.workers}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{r.manDays}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <div className="flex flex-col gap-4">
        <Card title={`Plucking · ${s.estate.name}`}>
          {byCrop.length === 0 && <p className="text-muted">No weigh-ins yet.</p>}
          <ul>
            {byCrop.map((c) => (
              <li key={c.crop} className="text-lg">
                {cropText(c.crop)}: <strong>{c.netKg} kg</strong> from {c.workers} {c.workers === 1 ? "worker" : "workers"} ({c.entries} {c.entries === 1 ? "weigh-in" : "weigh-ins"})
              </li>
            ))}
          </ul>
          {s.weighIn.workersWithSeveralEntries > 0 && <p className="text-sm text-muted">{s.weighIn.workersWithSeveralEntries} worker(s) were weighed more than once today.</p>}
        </Card>
        <Card title={`Daily log · ${s.estate.name}`}>
          <ul>
            {s.dailyLog.map((r) => (
              <li key={r.readingAt + r.kind}>
                {timeText(r.readingAt)} · {r.kind}: {r.value} {r.unit ?? ""}
              </li>
            ))}
            {s.dailyLog.length === 0 && <li className="text-muted">No readings yet.</li>}
          </ul>
        </Card>
      </div>
    </div>
  );
}

interface RangeFilter {
  fieldId: string;
  crop: string;
  worker: string;
}
const hasKg = (kg: string) => Number.parseFloat(kg) > 0;

function PluckingRange({ estateId, name, from, to, showName, filter }: { estateId: string; name: string; from: string; to: string; showName: boolean; filter: RangeFilter }) {
  const app = useApp();
  const { pepper } = useCrops();
  const q = useQuery({
    queryKey: ["season", estateId, from, to],
    queryFn: () => api<Plucking>(`/estates/${estateId}/reports/plucking?from=${from}&to=${to}`),
    enabled: app.online,
  });
  if (q.isLoading) return <p>Loading…</p>;
  if (q.error || !q.data) return <Notice tone="bad">Could not load the report{showName ? ` for ${name}` : ""}.</Notice>;
  const r = q.data;
  const byField = r.byField.filter((f) => (!filter.fieldId || f.fieldId === filter.fieldId) && (!filter.crop || (filter.crop === "COFFEE" ? f.coffeeNetG > 0 : hasKg(f.pepperNetKg))));
  const byWorker = (r.byWorker ?? []).filter(
    (w) =>
      (!filter.worker || `${w.worker} ${w.employeeCode}`.toLowerCase().includes(filter.worker.toLowerCase())) && (!filter.crop || (filter.crop === "COFFEE" ? w.coffeeNetG > 0 : hasKg(w.pepperNetKg))),
  );
  const topWorker = Math.max(0, ...(r.byWorker ?? []).map((w) => w.coffeeNetG));
  const topField = Math.max(0, ...r.byField.map((f) => f.coffeeNetG));
  return (
    <>
      <Card
        title={showName ? `By field · ${name}` : "By field"}
        actions={
          <span className="text-sm text-muted">
            Coffee {r.totals.coffeeNetKg} kg{pepper && <> · Pepper {r.totals.pepperNetKg} kg</>}
          </span>
        }
      >
        {byField.length === 0 ? (
          <p className="text-muted">{r.byField.length === 0 ? "No weigh-ins in these days." : "No fields match these filters."}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-sm">
              <thead className="border-b border-line">
                <tr>
                  <Th>Field</Th>
                  <Th right>Worker-days</Th>
                  <Th right>Coffee kg</Th>
                  <Th />
                  {pepper && <Th right>Pepper kg</Th>}
                  <Th right>Coffee per worker-day</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {byField.map((f) => (
                  <tr key={f.fieldId}>
                    <td className="px-3 py-2">{f.field}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{f.workerDays}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{f.coffeeNetKg}</td>
                    <td className="px-3 py-2">
                      <Bar value={f.coffeeNetG} max={topField} />
                    </td>
                    {pepper && <td className="px-3 py-2 text-right tabular-nums">{f.pepperNetKg}</td>}
                    <td className="px-3 py-2 text-right tabular-nums">{f.coffeePerWorkerDayKg}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {r.byWorker && (
        <Card title={showName ? `By worker · ${name}` : "By worker"} actions={<span className="text-sm text-muted">Most coffee first</span>}>
          {byWorker.length === 0 ? (
            <p className="text-muted">{r.byWorker.length === 0 ? "No weigh-ins in these days." : "No workers match these filters."}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[38rem] text-sm">
                <thead className="border-b border-line">
                  <tr>
                    <Th>Worker</Th>
                    <Th right>Days</Th>
                    <Th right>Weigh-ins</Th>
                    <Th right>Coffee kg</Th>
                    <Th>Compared with the top worker</Th>
                    {pepper && <Th right>Pepper kg</Th>}
                    <Th right>Best day</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {byWorker.map((w) => (
                    <tr key={w.workerId}>
                      <td className="px-3 py-2">
                        <span className="font-mono text-xs text-muted">{w.employeeCode}</span> {w.worker}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{w.days}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{w.entries}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{w.coffeeNetKg}</td>
                      <td className="px-3 py-2">
                        <Bar value={w.coffeeNetG} max={topWorker} />
                      </td>
                      {pepper && <td className="px-3 py-2 text-right tabular-nums">{w.pepperNetKg}</td>}
                      <td className="px-3 py-2 text-right tabular-nums">{w.bestDayKg}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-2 text-sm text-muted">Weights only. No pay or rate is worked out here.</p>
        </Card>
      )}
    </>
  );
}

export function Summary() {
  const app = useApp();
  const estates = app.ref?.estates ?? [];
  const scope = app.allEstates && estates.length > 1 ? estates : estates.filter((e) => e.id === app.estateId);
  const multi = scope.length > 1;
  const [view, setView] = useState<"day" | "range" | "files">("day");
  const [rEstate, setREstate] = useState("");
  const [rField, setRField] = useState("");
  const [rCrop, setRCrop] = useState("");
  const [rWorker, setRWorker] = useState("");
  const [fileBusy, setFileBusy] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [from, setFrom] = useState(addDays(app.date, -6));
  const [to, setTo] = useState(app.date);
  const [copied, setCopied] = useState<"ok" | "fail" | null>(null);
  const { pepper } = useCrops();
  const seasonStart = useDashboards().list.find((d) => d.season.startDate)?.season.startDate ?? null;

  const results = useQueries({
    queries: scope.map((e) => ({
      queryKey: ["summary", e.id, app.date],
      queryFn: () => api<Summary>(`/estates/${e.id}/reports/daily/${app.date}`),
      enabled: app.online && app.can("reports.read", e.id),
    })),
  });
  const list = results.flatMap((r) => (r.data ? [r.data] : []));
  const message = list.length ? whatsappMessage(app.date, list, pepper) : "";

  async function copy() {
    try {
      await navigator.clipboard.writeText(message);
      setCopied("ok");
    } catch {
      setCopied("fail");
    }
  }

  async function download(estate: { id: string; name: string }, format: "old" | "new", all = false) {
    setFileError(null);
    setFileBusy(`${all ? "all" : estate.id}:${format}`);
    try {
      const { blob, filename } = await apiFile(all ? `/reports/export?format=${format}&from=${from}&to=${to}` : `/estates/${estate.id}/reports/export?format=${format}&from=${from}&to=${to}`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      setFileError(e instanceof ApiError ? `${estate.name}: ${e.message}` : "Could not reach the server.");
    } finally {
      setFileBusy(null);
    }
  }

  if (!app.online) return <Notice tone="warn">Reports need signal. {app.queue.waiting} entries are waiting on this phone.</Notice>;
  const pending = list.reduce((n, s) => n + s.sync.entriesWaitingOnDevices, 0);
  const conflicts = list.reduce((n, s) => n + s.sync.openConflicts, 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="lg:flex lg:flex-wrap lg:items-baseline lg:gap-x-4">
          <h1>Reports</h1>
          <p className="mt-1 lg:mt-0 max-w-xl text-sm text-muted">{multi ? "All estates together." : "One estate."} Figures count only what the server has received.</p>
        </div>
        <fieldset className="inline-flex gap-0.5 rounded-xl border-0 bg-surface-2 p-[3px]">
          <legend className="sr-only">Report</legend>
          {([["day", "Day summary"], ["range", "Plucking by field and worker"], ...(app.can("reports.workerDetail") ? ([["files", "Excel files"]] as const) : [])] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={view === id}
              onClick={() => setView(id)}
              className={`min-h-9 rounded-lg px-3 text-sm font-medium transition-colors ${view === id ? "bg-surface text-ink shadow-[0_0_0_1px_var(--color-line)]" : "text-muted hover:text-ink"}`}
            >
              {label}
            </button>
          ))}
        </fieldset>
      </div>

      {view === "day" && (
        <>
          {results.some((r) => r.isLoading) && <p>Loading…</p>}
          {results.some((r) => r.error) && <Notice tone="bad">Could not load the summary.</Notice>}
          {list.length > 0 && (
            <>
              <Notice tone={pending > 0 || app.queue.waiting > 0 || conflicts > 0 ? "warn" : "info"}>
                {list[0]?.sync.note} {pending > 0 && `${pending} entries are still waiting on supervisor phones.`} {app.queue.waiting > 0 && `This phone has ${app.queue.waiting} waiting.`}
                {conflicts > 0 && ` ${conflicts} conflict(s) need a manager.`}
              </Notice>
              <Card
                title="Message to send"
                actions={
                  <Button size="sm" onClick={() => void copy()}>
                    Copy for WhatsApp
                  </Button>
                }
              >
                <pre className="whitespace-pre-wrap break-words font-sans text-sm">{message}</pre>
                {copied === "ok" && <p className="mt-2 text-sm text-ok">Copied. Paste it into WhatsApp.</p>}
                {copied === "fail" && <p className="mt-2 text-sm text-bad">Could not copy automatically. Select the text above and copy it.</p>}
              </Card>
              {list.map((s) => (
                <DaySummary key={s.estate.id} s={s} />
              ))}
            </>
          )}
        </>
      )}

      {view === "files" && (
        <Card title="Excel files">
          <p className="mb-3 max-w-2xl text-sm text-muted">
            Choose the dates. <b>Old format</b> is the estate's daily sheet: one sheet for each date, attendance on the left and plucking on the right (up to 62 days). <b>New format</b> keeps the same
            data as plain tables (summary by day, attendance, plucking) and is the one to keep as a backup. Only entries the server has received are included.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="From" htmlFor="file-from">
              <Input id="file-from" type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} />
            </Field>
            <Field label="To" htmlFor="file-to">
              <Input id="file-to" type="date" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} />
            </Field>
          </div>
          {from > to && <p className="mt-2 text-sm text-bad">The start date is after the end date.</p>}
          {fileError && (
            <div className="mt-3">
              <Notice tone="bad">{fileError}</Notice>
            </div>
          )}
          <div className="mt-4 flex flex-col gap-3">
            {estates.length > 1 && (
              <div className="flex flex-wrap items-center gap-2">
                <b className="min-w-40">Both estates in one file</b>
                <Button disabled={from > to || fileBusy !== null} onClick={() => void download({ id: "all", name: "All estates" }, "old", true)}>
                  {fileBusy === "all:old" ? "Preparing…" : "Download old format (daily sheets)"}
                </Button>
                <Button disabled={from > to || fileBusy !== null} onClick={() => void download({ id: "all", name: "All estates" }, "new", true)}>
                  {fileBusy === "all:new" ? "Preparing…" : "Download new format (backup)"}
                </Button>
              </div>
            )}
            {estates.map((e) => (
              <div key={e.id} className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
                <b className="min-w-40">{e.name}</b>
                <Button variant="secondary" disabled={from > to || fileBusy !== null} onClick={() => void download(e, "old")}>
                  {fileBusy === `${e.id}:old` ? "Preparing…" : "Download old format (daily sheets)"}
                </Button>
                <Button variant="secondary" disabled={from > to || fileBusy !== null} onClick={() => void download(e, "new")}>
                  {fileBusy === `${e.id}:new` ? "Preparing…" : "Download new format (backup)"}
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {view === "range" && (
        <>
          <Card>
            <div className="flex flex-wrap items-end gap-3">
              <Field label="From" htmlFor="rep-from">
                <Input id="rep-from" type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} />
              </Field>
              <Field label="To" htmlFor="rep-to">
                <Input id="rep-to" type="date" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} />
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setFrom(addDays(app.date, -6));
                    setTo(app.date);
                  }}
                >
                  Last 7 days
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setFrom(addDays(app.date, -29));
                    setTo(app.date);
                  }}
                >
                  Last 30 days
                </Button>
                {seasonStart && (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setFrom(seasonStart);
                      setTo(app.date);
                    }}
                  >
                    Season to date
                  </Button>
                )}
              </div>
            </div>
            {from > to && <p className="mt-2 text-sm text-bad">The start date is after the end date.</p>}
            <div className="mt-3 border-t border-line pt-3">
              <FilterBar
                shown={scope.filter((e) => !rEstate || e.id === rEstate).length}
                total={scope.length}
                noun="estates"
                active={!!(rEstate || rField || rCrop || rWorker)}
                onClear={() => {
                  setREstate("");
                  setRField("");
                  setRCrop("");
                  setRWorker("");
                }}
              >
                {multi && (
                  <FilterSelect
                    label="Estate"
                    value={rEstate}
                    onChange={(v) => {
                      setREstate(v);
                      setRField("");
                    }}
                    options={[{ value: "", label: "All estates" }, ...scope.map((e) => ({ value: e.id, label: e.name }))]}
                  />
                )}
                <FilterSelect
                  label="Field"
                  value={rField}
                  onChange={setRField}
                  options={[
                    { value: "", label: "All fields" },
                    ...(app.ref?.fields ?? []).filter((f) => scope.some((e) => e.id === f.estateId) && (!rEstate || f.estateId === rEstate)).map((f) => ({ value: f.id, label: f.name })),
                  ]}
                />
                {pepper && (
                  <FilterSelect
                    label="Crop"
                    value={rCrop}
                    onChange={setRCrop}
                    options={[
                      { value: "", label: "Coffee and pepper" },
                      { value: "COFFEE", label: "Coffee" },
                      { value: "PEPPER", label: "Pepper" },
                    ]}
                  />
                )}
                <FilterSearch label="Find a worker" value={rWorker} onChange={setRWorker} placeholder="Name or code" />
              </FilterBar>
              <p className="mt-1 text-xs text-muted">Field applies to the by-field table, Find a worker to the by-worker table; Crop applies to both.</p>
            </div>
          </Card>
          {from <= to &&
            scope
              .filter((e) => !rEstate || e.id === rEstate)
              .map((e) => <PluckingRange key={e.id} estateId={e.id} name={e.name} from={from} to={to} showName={multi} filter={{ fieldId: rField, crop: rCrop, worker: rWorker }} />)}
        </>
      )}
    </div>
  );
}
