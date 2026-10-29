import { addDays, formatScaled, parseReading, ReadingError } from "@cemms/domain";
import { useQueries } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useApp } from "../app-context";
import { Button, Card, Chip, Field, Input, Notice, Select, StatusBadge } from "../components/ui";
import { api } from "../lib/api";
import { db, type LocalRecord } from "../lib/db";
import { todayIn, useLive } from "../lib/hooks";
import { queueChange } from "../lib/outbox";
import { useUnsaved } from "../lib/unsaved";

interface RangeReading {
  id: string;
  businessDate: string;
  readingAt: string;
  kindId: string;
  valueScaled: number | null;
  valueText: string | null;
  remarks: string | null;
}
interface RangeData {
  from: string;
  to: string;
  kinds: { id: string; label: string; unit: string | null; decimals: number; valueType: "NUMBER" | "TEXT"; expectedPerDay: number | null; active: boolean }[];
  readings: RangeReading[];
}

/** One reading as listed: from the server, or still on this phone. */
interface Row {
  id: string;
  estateId: string;
  date: string;
  at: string;
  kindId: string;
  value: string;
  remarks: string;
  status: LocalRecord["status"];
  message?: string;
}

const CHART_DAYS = 14;
/** Estate colours in the chart and its key: roast, teal, caramel, cherry. */
const ESTATE_COLORS = ["var(--color-roast)", "var(--color-info)", "var(--color-caramel)", "var(--color-cherry)"];

const shortDay = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
const dayWithWeekday = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true }).toUpperCase();
const localTime = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

/** Bars for each day, one bar per estate side by side. */
function EstateChart({ days, series, unit }: { days: string[]; series: { estateId: string; color: string; values: (number | null)[] }[]; unit: string | null }) {
  const W = 640;
  const H = 170;
  const L = 34;
  const B = 22;
  const T = 10;
  const max = Math.max(0, ...series.flatMap((s) => s.values.map((v) => v ?? 0)));
  const top = max <= 10 ? 10 : Math.ceil(max / 10) * 10;
  const gw = (W - L - 6) / days.length;
  const bw = Math.min(14, (gw - 6) / Math.max(1, series.length));
  const y = (v: number) => T + (H - T - B) * (1 - v / top);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Readings per day${unit ? ` in ${unit}` : ""}, by estate`} className="w-full">
      {[0, top / 2, top].map((t) => (
        <g key={t}>
          <line x1={L} x2={W - 4} y1={y(t)} y2={y(t)} stroke="var(--color-line)" />
          <text x={L - 6} y={y(t) + 3} textAnchor="end" fontSize="10" fill="var(--color-muted)">
            {t.toLocaleString("en-IN", { maximumFractionDigits: 1 })}
          </text>
        </g>
      ))}
      {days.map((d, i) => {
        const x0 = L + i * gw + (gw - bw * series.length) / 2;
        return (
          <g key={d}>
            {series.map((s, k) => {
              const v = s.values[i];
              if (v === null || v === undefined) return null;
              const bh = Math.max(v > 0 ? 1.5 : 0, (H - T - B) * (v / top));
              return (
                <rect key={s.estateId} x={x0 + k * bw} y={H - B - bh} width={Math.max(2, bw - 1)} height={bh} rx="2" fill={s.color}>
                  <title>
                    {shortDay(d)}: {v.toLocaleString("en-IN", { maximumFractionDigits: 2 })} {unit ?? ""}
                  </title>
                </rect>
              );
            })}
            {(i % 2 === 0 || i === days.length - 1) && (
              <text x={L + i * gw + gw / 2} y={H - 6} textAnchor="middle" fontSize="10" fill="var(--color-muted)">
                {shortDay(d)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export function DailyLog() {
  const app = useApp();
  const { ref, estateId, date, session } = app;
  const tenantId = session.user.tenantId;
  const kinds = ref?.logKinds ?? [];
  const activeKinds = kinds.filter((k) => k.active !== false);
  const readable = useMemo(() => (ref?.estates ?? []).filter((e) => app.can("dailylog.read", e.id)), [ref, app]);
  // The estate picker at the top decides what is listed: one estate, or all of them when "All estates" is chosen.
  const estates = useMemo(() => (app.allEstates && readable.length > 1 ? readable : readable.filter((e) => e.id === estateId)), [readable, app.allEstates, estateId]);
  const writable = estates.filter((e) => app.can("dailylog.capture", e.id));
  const [range, setRange] = useState<"day" | "week">("day");
  const from = addDays(date, -(CHART_DAYS - 1));

  // The form: its own date, time and estate, starting from the day and estate chosen at the top.
  const [fDate, setFDate] = useState(date);
  const [fEstate, setFEstate] = useState("");
  const [kindId, setKindId] = useState("");
  const [value, setValue] = useState("");
  const [time, setTime] = useState(localTime);
  const [remarks, setRemarks] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  useUnsaved(!!(value || remarks));
  useEffect(() => setFDate(date), [date]);
  useEffect(() => setFEstate(""), [estateId, app.allEstates]);
  const formEstate = writable.find((e) => e.id === fEstate) ?? writable.find((e) => e.id === estateId) ?? writable[0];
  const kind = activeKinds.find((k) => k.id === (kindId || activeKinds[0]?.id));

  const parsed = (() => {
    if (!kind || !value) return null;
    try {
      parseReading({ ...kind, minScaled: null, maxScaled: null }, value);
      return null;
    } catch (e) {
      return e instanceof ReadingError ? e.message : "Check the value";
    }
  })();
  const today = formEstate ? todayIn(formEstate.timeZone) : fDate;
  const timing = fDate > today ? "The date cannot be in the future." : fDate === today && time > localTime() ? "The time cannot be in the future." : null;
  const error = parsed ?? null;

  const queries = useQueries({
    queries: estates.map((e) => ({
      queryKey: ["dailylog-range", e.id, from, date],
      queryFn: () => api<RangeData>(`/estates/${e.id}/daily-log?from=${from}&to=${date}`),
      enabled: app.online,
    })),
  });
  const local = useLive(
    async () => {
      const lists = await Promise.all(
        estates.map((e) =>
          db.records.where("[tenantId+entityType+estateId+businessDate]").between([tenantId, "dailylog_entry", e.id, from], [tenantId, "dailylog_entry", e.id, date], true, true).toArray(),
        ),
      );
      return lists.flat();
    },
    [tenantId, estates.map((e) => e.id).join(","), from, date],
    [] as LocalRecord[],
  );

  const kindOf = (id: string) => kinds.find((k) => k.id === id);
  const show = (r: { valueText: string | null; valueScaled: number | null }, kindId: string) => r.valueText ?? formatScaled(r.valueScaled ?? 0, kindOf(kindId)?.decimals ?? 0);
  const rows = useMemo(() => {
    const out = new Map<string, Row>();
    queries.forEach((q, i) => {
      const e = estates[i];
      if (!e) return;
      for (const r of q.data?.readings ?? [])
        out.set(r.id, { id: r.id, estateId: e.id, date: r.businessDate, at: r.readingAt, kindId: r.kindId, value: show(r, r.kindId), remarks: r.remarks ?? "", status: "accepted" });
    });
    for (const r of local) {
      if (out.has(r.entityId) && r.status === "accepted") continue;
      const d = r.data as { kindId: string; readingAt: string; value: string; remarks?: string | null };
      out.set(r.entityId, {
        id: r.entityId,
        estateId: r.estateId,
        date: r.businessDate,
        at: d.readingAt,
        kindId: d.kindId,
        value: d.value,
        remarks: d.remarks ?? "",
        status: r.status,
        message: r.message,
      });
    }
    return [...out.values()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queries.map((q) => q.dataUpdatedAt).join(","), local, estates, kinds]);

  const weekFrom = addDays(date, -6);
  const listed = rows
    .filter((r) => (range === "day" ? r.date === date : r.date >= weekFrom && r.date <= date))
    .sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : a.at.localeCompare(b.at)));
  const estateName = (id: string) => readable.find((e) => e.id === id)?.name ?? "?";
  const unitOf = (id: string) => kindOf(id)?.unit ?? "";

  async function save() {
    if (!kind || !formEstate || error || timing || !value) return;
    const at = new Date(`${fDate}T${time}:00`);
    await queueChange({
      tenantId,
      userId: session.user.id,
      deviceId: app.deviceId,
      entityType: "dailylog_entry",
      op: "create",
      estateId: formEstate.id,
      businessDate: fDate,
      payload: { businessDate: fDate, kindId: kind.id, readingAt: at.toISOString(), value: value.trim(), remarks: remarks.trim() || null },
      label: `Daily log: ${kind.label} ${value}`,
    });
    setSaved(`${kind.label} ${value} ${kind.unit ?? ""} saved on this phone for ${formEstate.name}.`);
    setValue("");
    setRemarks("");
    setTime(localTime());
    void app.sync();
  }

  // Progress against how many readings each kind should have on the chosen day, per estate. Only server-accepted readings count as done.
  const expected = activeKinds.filter((k) => k.expectedPerDay);
  const status = estates.map((e) => {
    const per = expected.map((k) => {
      const n = rows.filter((r) => r.estateId === e.id && r.date === date && r.kindId === k.id && r.status === "accepted").length;
      return { kind: k, n, need: k.expectedPerDay ?? 0 };
    });
    return { estate: e, per, done: per.reduce((s, x) => s + Math.min(x.n, x.need), 0), need: per.reduce((s, x) => s + x.need, 0) };
  });

  // The chart: one numeric reading per day for each estate. Rain (mm) first, as in the estate's own log.
  const numeric = activeKinds.filter((k) => k.valueType === "NUMBER");
  const [chartKindId, setChartKindId] = useState("");
  const [how, setHow] = useState<"total" | "average" | "highest" | "">("");
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.kindId, (counts.get(r.kindId) ?? 0) + 1);
  const chartKind = numeric.find((k) => k.id === chartKindId) ?? numeric.find((k) => k.unit === "mm") ?? [...numeric].sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0))[0];
  const mode = how || (chartKind?.unit === "mm" ? "total" : "average");
  const days = Array.from({ length: CHART_DAYS }, (_, i) => addDays(from, i));
  const series = estates.map((e, k) => ({
    estateId: e.id,
    color: ESTATE_COLORS[k % ESTATE_COLORS.length] as string,
    values: days.map((d) => {
      const vs = rows
        .filter((r) => r.estateId === e.id && r.date === d && r.kindId === chartKind?.id && r.status === "accepted")
        .map((r) => Number(r.value))
        .filter((n) => Number.isFinite(n));
      if (vs.length === 0) return null;
      const sum = vs.reduce((a, b) => a + b, 0);
      return mode === "total" ? sum : mode === "average" ? sum / vs.length : Math.max(...vs);
    }),
  }));

  if (!ref) return <Notice>Connect to the internet once to download the lists.</Notice>;
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1>Daily log</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">Readings for every estate, such as temperature and rain. Pick the time of each reading. New kinds are added under Masters.</p>
      </div>

      {expected.length > 0 && estates.length > 0 && (
        <div className="grid overflow-hidden rounded-2xl border border-line bg-surface sm:grid-cols-2">
          {status.map((s) => (
            <div key={s.estate.id} className="flex min-w-0 flex-col gap-1 border-line p-4 [&:not(:first-child)]:border-t sm:[&:not(:first-child)]:border-t-0 sm:[&:not(:first-child)]:border-l">
              <span className="text-xs font-semibold text-muted">{s.estate.name}</span>
              <span className="text-2xl font-semibold tabular-nums leading-tight">
                {s.done} <span className="text-sm font-normal text-muted">of {s.need} readings</span>
              </span>
              <div className="flex flex-wrap gap-1.5">
                {s.per.map((x) => (
                  <Chip key={x.kind.id} tone={x.n >= x.need ? "ok" : "warn"}>
                    {x.kind.label} {x.n} of {x.need}
                  </Chip>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <Card title="Add a reading">
        {activeKinds.length === 0 && <Notice tone="warn">No reading types are set up yet. The owner adds them under Masters → Log kinds.</Notice>}
        {writable.length === 0 && activeKinds.length > 0 && <Notice tone="warn">You can view the log but not add readings.</Notice>}
        {saved && <Notice tone="ok">{saved}</Notice>}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="Date" htmlFor="dl-date">
            <Input id="dl-date" type="date" value={fDate} max={today} onChange={(e) => e.target.value && setFDate(e.target.value)} />
          </Field>
          <Field label="Time" htmlFor="dl-time">
            <Input id="dl-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
          <Field label="Estate" htmlFor="dl-estate">
            <Select id="dl-estate" value={formEstate?.id ?? ""} onChange={(e) => setFEstate(e.target.value)}>
              {writable.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Kind" htmlFor="dl-kind">
            <Select id="dl-kind" value={kind?.id ?? ""} onChange={(e) => setKindId(e.target.value)}>
              {activeKinds.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={`Data${kind?.unit ? ` (${kind.unit})` : ""}`} htmlFor="dl-value" error={error ?? undefined}>
            <Input id="dl-value" inputMode={kind?.valueType === "TEXT" ? "text" : "decimal"} placeholder="0.0" value={value} onChange={(e) => setValue(e.target.value)} />
          </Field>
        </div>
        <div className="mt-3">
          <Field label="Remarks (optional)" htmlFor="dl-remarks" error={timing ?? undefined}>
            <Input id="dl-remarks" maxLength={500} placeholder="For example, heavy shower at 3 pm" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </Field>
        </div>
        <div className="mt-4">
          <Button size="lg" disabled={!app.can("dailylog.capture") || !formEstate || !kind || !value || !!error || !!timing} onClick={save}>
            Add to the log
          </Button>
        </div>
      </Card>

      <Card
        title={range === "day" ? dayWithWeekday(date) : `Readings from ${shortDay(weekFrom)} to ${shortDay(date)}`}
        actions={
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted">
              {listed.length} reading{listed.length === 1 ? "" : "s"}
            </span>
            <fieldset className="inline-flex gap-0.5 rounded-xl border-0 bg-surface-2 p-[3px]">
              <legend className="sr-only">Show</legend>
              {(
                [
                  ["day", "This day"],
                  ["week", "Last 7 days"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={range === id}
                  onClick={() => setRange(id)}
                  className={`min-h-9 rounded-lg px-3 text-sm font-medium ${range === id ? "bg-surface text-ink shadow-[0_0_0_1px_var(--color-line)]" : "text-muted hover:text-ink"}`}
                >
                  {label}
                </button>
              ))}
            </fieldset>
          </div>
        }
      >
        {app.online && queries.some((q) => q.isLoading) && listed.length === 0 && <p>Loading…</p>}
        {queries.some((q) => q.isError) && <Notice tone="bad">Some readings could not be loaded.</Notice>}
        {listed.length === 0 && !queries.some((q) => q.isLoading) ? (
          <p className="text-muted">No readings for this period.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead className="border-b border-line">
                <tr>
                  {["Date", "Time", "Estate", "Kind"].map((t) => (
                    <th key={t} className="px-3 py-2 text-left text-[0.8rem] font-medium text-muted">
                      {t}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-right text-[0.8rem] font-medium text-muted">Data</th>
                  <th className="px-3 py-2 text-left text-[0.8rem] font-medium text-muted">Remarks</th>
                  <th className="px-3 py-2 text-left text-[0.8rem] font-medium text-muted">State</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {listed.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap px-3 py-2">{dayWithWeekday(r.date)}</td>
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums">{clock(r.at)}</td>
                    <td className="px-3 py-2">{estateName(r.estateId)}</td>
                    <td className="px-3 py-2">{kindOf(r.kindId)?.label ?? "?"}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums">
                      {r.value} {unitOf(r.kindId)}
                    </td>
                    <td className="px-3 py-2">
                      {r.remarks}
                      {r.message && r.status !== "accepted" && <span className="block text-bad">{r.message}</span>}
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={r.status} compact />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {chartKind && estates.length > 0 && (
        <Card
          title={`${chartKind.label} per day${chartKind.unit ? ` (${chartKind.unit})` : ""}`}
          actions={
            <span className="flex flex-wrap items-center gap-3 text-sm text-muted">
              {series.map((s) => (
                <span key={s.estateId} className="inline-flex items-center gap-1.5">
                  <span aria-hidden className="inline-block size-3 rounded-sm" style={{ background: s.color }} />
                  {estateName(s.estateId)}
                </span>
              ))}
            </span>
          }
        >
          <div className="mb-3 grid gap-3 sm:grid-cols-2">
            <Field label="Reading" htmlFor="chart-kind">
              <Select id="chart-kind" value={chartKind.id} onChange={(e) => setChartKindId(e.target.value)}>
                {numeric.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.label}
                    {k.unit ? ` (${k.unit})` : ""}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Per day show" htmlFor="chart-how">
              <Select id="chart-how" value={mode} onChange={(e) => setHow(e.target.value as "total" | "average" | "highest")}>
                <option value="total">Total of the day</option>
                <option value="average">Average of the day</option>
                <option value="highest">Highest of the day</option>
              </Select>
            </Field>
          </div>
          <EstateChart days={days} series={series} unit={chartKind.unit} />
          <p className="mt-2 text-sm text-muted">The last {CHART_DAYS} days up to the day chosen above. Only readings the server has accepted are drawn.</p>
        </Card>
      )}
    </div>
  );
}
