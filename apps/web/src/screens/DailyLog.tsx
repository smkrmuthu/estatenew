import { addDays, formatScaled, parseReading, ReadingError } from "@cemms/domain";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useApp } from "../app-context";
import { Button, Card, Field, Input, Notice, Select, StatusBadge } from "../components/ui";
import { api } from "../lib/api";
import { db, type LocalRecord } from "../lib/db";
import { useLive } from "../lib/hooks";
import { queueChange } from "../lib/outbox";
import { useUnsaved } from "../lib/unsaved";

interface ServerReading {
  id: string;
  kindId: string;
  readingAt: string;
  valueScaled: number | null;
  valueText: string | null;
  status: "ACTIVE" | "VOID";
}

interface RangeReading {
  id: string;
  businessDate: string;
  readingAt: string;
  kindId: string;
  valueScaled: number | null;
  valueText: string | null;
}
interface RangeData {
  from: string;
  to: string;
  kinds: { id: string; label: string; unit: string | null; decimals: number; valueType: "NUMBER" | "TEXT"; expectedPerDay: number | null; active: boolean }[];
  readings: RangeReading[];
}

const shortDay = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

/** One bar per day for one reading kind. Totals suit rain; averages suit temperature. */
function KindChart({ days, unit }: { days: { date: string; value: number | null }[]; unit: string | null }) {
  const W = 600;
  const H = 170;
  const L = 44;
  const B = 22;
  const T = 10;
  const max = Math.max(1, ...days.map((d) => d.value ?? 0));
  const top = max <= 10 ? Math.ceil(max) : Math.ceil(max / 10) * 10;
  const bw = (W - L - 8) / days.length;
  const y = (v: number) => T + (H - T - B) * (1 - v / top);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Readings per day${unit ? ` in ${unit}` : ""}`} className="w-full">
      {[0, top / 2, top].map((t) => (
        <g key={t}>
          <line x1={L} x2={W - 4} y1={y(t)} y2={y(t)} stroke="var(--color-line)" />
          <text x={L - 6} y={y(t) + 3} textAnchor="end" fontSize="10" fill="var(--color-muted)">
            {t.toLocaleString("en-IN", { maximumFractionDigits: 1 })}
          </text>
        </g>
      ))}
      {days.map((d, i) => {
        const last = i === days.length - 1;
        const v = d.value;
        return (
          <g key={d.date}>
            {v !== null && (
              <rect
                x={L + i * bw + 1.5}
                y={y(v)}
                width={Math.max(1, bw - 3)}
                height={Math.max(0, H - B - y(v))}
                rx="2"
                fill={last ? "var(--color-caramel)" : "var(--color-roast)"}
                opacity={last ? 1 : 0.75}
              >
                <title>
                  {shortDay(d.date)}: {v.toLocaleString("en-IN", { maximumFractionDigits: 2 })} {unit ?? ""}
                </title>
              </rect>
            )}
            {(i % Math.max(1, Math.round(days.length / 6)) === 0 || last) && (
              <text x={L + i * bw + bw / 2} y={H - 6} textAnchor="middle" fontSize="10" fill="var(--color-muted)">
                {shortDay(d.date)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function Trend({ estateId, date }: { estateId: string; date: string }) {
  const app = useApp();
  const [span, setSpan] = useState<7 | 30>(7);
  const [kindId, setKindId] = useState("");
  const [how, setHow] = useState<"total" | "average" | "highest" | "">("");
  const from = addDays(date, -(span - 1));
  const q = useQuery({
    queryKey: ["dailylog-range", estateId, from, date],
    queryFn: () => api<RangeData>(`/estates/${estateId}/daily-log?from=${from}&to=${date}`),
    enabled: app.online && !!estateId && app.can("dailylog.read"),
  });
  const data = q.data;
  const numeric = (data?.kinds ?? []).filter((k) => k.valueType === "NUMBER" && k.active);
  // Open on the reading that has the most values in these days, so the chart is not empty by default.
  const counts = new Map<string, number>();
  for (const r of data?.readings ?? []) counts.set(r.kindId, (counts.get(r.kindId) ?? 0) + 1);
  const busiest = [...numeric].sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0))[0];
  const kind = numeric.find((k) => k.id === kindId) ?? busiest;
  const mode = how || (kind?.unit === "mm" ? "total" : "average");
  const days = Array.from({ length: span }, (_, i) => addDays(from, i));
  const series = days.map((d) => {
    const vs = (data?.readings ?? []).filter((r) => r.businessDate === d && r.kindId === kind?.id && r.valueScaled !== null).map((r) => (r.valueScaled as number) / 10 ** (kind?.decimals ?? 0));
    if (vs.length === 0) return { date: d, value: null };
    const sum = vs.reduce((a, b) => a + b, 0);
    return { date: d, value: mode === "total" ? sum : mode === "average" ? sum / vs.length : Math.max(...vs) };
  });
  const grouped = days
    .slice()
    .reverse()
    .map((d) => ({ date: d, items: (data?.readings ?? []).filter((r) => r.businessDate === d) }))
    .filter((g) => g.items.length > 0);
  const kindName = (id: string) => data?.kinds.find((k) => k.id === id);
  return (
    <Card
      title="Readings over time"
      actions={
        <fieldset className="inline-flex gap-0.5 rounded-xl border-0 bg-surface-2 p-[3px]">
          <legend className="sr-only">Period</legend>
          {([7, 30] as const).map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={span === n}
              onClick={() => setSpan(n)}
              className={`min-h-9 rounded-lg px-3 text-sm font-medium ${span === n ? "bg-surface text-ink shadow-[0_0_0_1px_var(--color-line)]" : "text-muted hover:text-ink"}`}
            >
              {n} days
            </button>
          ))}
        </fieldset>
      }
    >
      {!app.online && <p className="text-muted">Needs signal.</p>}
      {app.online && q.isLoading && <p>Loading…</p>}
      {app.online && q.error && <Notice tone="bad">Could not load the readings.</Notice>}
      {data && numeric.length === 0 && <p className="text-muted">No numeric reading kinds yet.</p>}
      {data && kind && (
        <>
          <div className="mb-3 grid gap-3 sm:grid-cols-2">
            <Field label="Reading" htmlFor="trend-kind">
              <Select id="trend-kind" value={kind.id} onChange={(e) => setKindId(e.target.value)}>
                {numeric.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.label}
                    {k.unit ? ` (${k.unit})` : ""}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Per day show" htmlFor="trend-how">
              <Select id="trend-how" value={mode} onChange={(e) => setHow(e.target.value as "total" | "average" | "highest")}>
                <option value="total">Total of the day</option>
                <option value="average">Average of the day</option>
                <option value="highest">Highest of the day</option>
              </Select>
            </Field>
          </div>
          <KindChart days={series} unit={kind.unit} />
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[22rem] text-sm">
              <thead className="border-b border-line">
                <tr>
                  <th className="px-3 py-2 text-left text-[0.8rem] font-medium text-muted">Day</th>
                  <th className="px-3 py-2 text-left text-[0.8rem] font-medium text-muted">Readings</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {grouped.map((g) => (
                  <tr key={g.date}>
                    <td className="px-3 py-2 align-top tabular-nums">{shortDay(g.date)}</td>
                    <td className="px-3 py-2">
                      {g.items.map((r) => {
                        const k = kindName(r.kindId);
                        return (
                          <span key={r.id} className="mr-3 inline-block whitespace-nowrap">
                            {k?.label}: {r.valueText ?? formatScaled(r.valueScaled ?? 0, k?.decimals ?? 0)} {k?.unit ?? ""}{" "}
                            <span className="text-muted">{new Date(r.readingAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                          </span>
                        );
                      })}
                    </td>
                  </tr>
                ))}
                {grouped.length === 0 && (
                  <tr>
                    <td className="px-3 py-2 text-muted" colSpan={2}>
                      No readings in these days.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}

const localTime = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

export function DailyLog() {
  const app = useApp();
  const { ref, estateId, date, session } = app;
  const tenantId = session.user.tenantId;
  const kinds = ref?.logKinds ?? [];
  const [kindId, setKindId] = useState("");
  const [value, setValue] = useState("");
  const [time, setTime] = useState(localTime);
  const [remarks, setRemarks] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  useUnsaved(!!(value || remarks));
  const kind = kinds.find((k) => k.id === kindId);

  const error = (() => {
    if (!kind || !value) return null;
    try {
      parseReading({ ...kind, minScaled: null, maxScaled: null }, value);
      return null;
    } catch (e) {
      return e instanceof ReadingError ? e.message : "Check the value";
    }
  })();

  const server = useQuery({
    queryKey: ["dailylog", estateId, date],
    queryFn: () => api<ServerReading[]>(`/estates/${estateId}/daily-log/${date}`),
    enabled: app.online && !!estateId && app.can("dailylog.read"),
  });
  const local = useLive(
    () => db.records.where("[tenantId+entityType+estateId+businessDate]").equals([tenantId, "dailylog_entry", estateId, date]).toArray(),
    [tenantId, estateId, date],
    [] as LocalRecord[],
  );
  const rows = useMemo(() => {
    const out = new Map<string, { id: string; kindId: string; kind: string; at: string; value: string; status: LocalRecord["status"]; message?: string }>();
    for (const r of server.data ?? []) {
      if (r.status === "VOID") continue;
      const k = kinds.find((x) => x.id === r.kindId);
      out.set(r.id, {
        id: r.id,
        kindId: r.kindId,
        kind: k?.label ?? "?",
        at: r.readingAt,
        value: `${r.valueText ?? formatScaled(r.valueScaled ?? 0, k?.decimals ?? 0)} ${k?.unit ?? ""}`,
        status: "accepted",
      });
    }
    for (const r of local) {
      if (out.has(r.entityId) && r.status === "accepted") continue;
      const d = r.data as { kindId: string; readingAt: string; value: string };
      const k = kinds.find((x) => x.id === d.kindId);
      out.set(r.entityId, { id: r.entityId, kindId: d.kindId, kind: k?.label ?? "?", at: d.readingAt, value: `${d.value} ${k?.unit ?? ""}`, status: r.status, message: r.message });
    }
    return [...out.values()].sort((a, b) => b.at.localeCompare(a.at));
  }, [server.data, local, kinds]);

  async function save() {
    if (!kind || error || !value) return;
    const [h, m] = time.split(":").map(Number);
    const at = new Date();
    at.setHours(h ?? 0, m ?? 0, 0, 0);
    const payload = { businessDate: date, kindId: kind.id, readingAt: at.toISOString(), value: value.trim(), remarks: remarks.trim() || null };
    await queueChange({
      tenantId,
      userId: session.user.id,
      deviceId: app.deviceId,
      entityType: "dailylog_entry",
      op: "create",
      estateId,
      businessDate: date,
      payload,
      label: `Daily log: ${kind.label} ${value}`,
    });
    setSaved(`${kind.label} ${value} ${kind.unit ?? ""} saved on this phone.`);
    setValue("");
    setRemarks("");
    setTime(localTime());
    void app.sync();
  }

  if (!ref) return <Notice>Connect to the internet once to download the lists.</Notice>;
  // Progress against how many readings each kind should have today. Only server-accepted readings count as done.
  const expected = kinds.filter((k) => k.active !== false && k.expectedPerDay);
  const doneFor = (id: string) => rows.filter((r) => r.kindId === id && r.status === "accepted").length;
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1>Daily log</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">Weather and other readings the supervisor takes during the day, such as rain and temperature.</p>
      </div>
      {expected.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {expected.map((k) => {
            const n = doneFor(k.id);
            const need = k.expectedPerDay ?? 0;
            return (
              <span key={k.id} className={`rounded-full px-3 py-1 text-sm font-medium ${n >= need ? "bg-ok/15 text-ok" : "bg-warn/15 text-warn"}`}>
                {k.label} {n} of {need}
              </span>
            );
          })}
        </div>
      )}
      <Card title={`Daily log · ${date}`}>
        {kinds.length === 0 && <Notice tone="warn">No reading types are set up yet. The owner adds them under Manage → Daily log types.</Notice>}
        {saved && <Notice tone="ok">{saved}</Notice>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Reading" htmlFor="kind">
            <Select id="kind" value={kindId} onChange={(e) => setKindId(e.target.value)}>
              <option value="">Choose…</option>
              {kinds.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.label}
                  {k.unit ? ` (${k.unit})` : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Time" htmlFor="time">
            <Input id="time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
          <Field label={`Value${kind?.unit ? ` (${kind.unit})` : ""}`} htmlFor="value" error={error ?? undefined}>
            <Input id="value" inputMode={kind?.valueType === "TEXT" ? "text" : "decimal"} value={value} onChange={(e) => setValue(e.target.value)} />
          </Field>
          <Field label="Remark (optional)" htmlFor="dl-remarks">
            <Input id="dl-remarks" maxLength={500} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </Field>
        </div>
        <div className="mt-4 flex justify-end">
          <Button size="lg" disabled={!app.can("dailylog.capture") || !kind || !value || !!error} onClick={save}>
            Save reading
          </Button>
        </div>
      </Card>
      <Card title="Today's readings">
        <ul className="divide-y divide-line">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-2 py-2">
              <div>
                <p className="font-semibold">
                  {r.kind}: {r.value}
                </p>
                <p className="text-sm text-muted">{new Date(r.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
                {r.message && r.status !== "accepted" && <p className="text-sm text-bad">{r.message}</p>}
              </div>
              <StatusBadge status={r.status} compact />
            </li>
          ))}
          {rows.length === 0 && <li className="py-2 text-muted">No readings yet.</li>}
        </ul>
      </Card>
      <Trend estateId={estateId} date={date} />
    </div>
  );
}
