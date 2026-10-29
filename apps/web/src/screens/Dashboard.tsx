import { formatKg, parseKg } from "@cemms/domain";
import { useQueries } from "@tanstack/react-query";
import { useApp } from "../app-context";
import { Icon } from "../components/Icon";
import { Card, Notice } from "../components/ui";
import { api } from "../lib/api";
import { useCrops } from "../lib/crops";

export interface DashboardData {
  basis: "server-accepted";
  estate: { id: string; name: string };
  season: { startDate: string | null; coffeeNetKg: string; expectedKg: string; percent: number | null };
  today: {
    sheetState: string;
    activeWorkers: number;
    marked: number;
    present: number;
    halfDayCount: number;
    absent: number;
    weighIns: number;
    coffeeNetKg: string;
    pepperNetKg: string;
    dailyLogReadings: number;
  };
  days: { date: string; coffeeNetKg: string; pepperNetKg: string; coffeeNetG: number; pepperNetG: number }[];
  attention: { sheetsAwaitingApproval: { date: string; submittedBy: string | null }[]; openConflicts: number; devicesWaiting: number; entriesWaitingOnDevices: number };
}

const SHEET_TEXT: Record<string, string> = { NOT_STARTED: "Not started", DRAFT: "Draft", SUBMITTED: "Submitted, waiting for approval", APPROVED: "Approved" };
const shortDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
const longDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

function Kpi({ label, value, note }: { label: string; value: React.ReactNode; note: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 border-line p-4 [&:not(:first-child)]:border-t sm:[&:not(:first-child)]:border-t-0 sm:[&:not(:first-child)]:border-l">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</span>
      <span className="text-2xl font-semibold tabular-nums leading-tight">{value}</span>
      <span className="text-sm text-muted">{note}</span>
    </div>
  );
}

/** Bars for the last days of accepted weigh-ins; the latest day is highlighted. */
function DailyChart({ days, pepper }: { days: DashboardData["days"]; pepper: boolean }) {
  const W = 600;
  const H = 170;
  const L = 44;
  const B = 22;
  const T = 10;
  const totals = days.map((d) => d.coffeeNetG + (pepper ? d.pepperNetG : 0));
  const maxKg = Math.max(100, ...totals.map((g) => g / 1000));
  const top = Math.ceil(maxKg / 200) * 200;
  const bw = (W - L - 8) / days.length;
  const y = (kg: number) => T + (H - T - B) * (1 - kg / top);
  const kgText = (g: number) => `${(g / 1000).toLocaleString("en-IN", { maximumFractionDigits: 1 })} kg`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={pepper ? "Net kilograms weighed in per day, coffee and pepper together" : "Net kilograms of coffee weighed in per day"} className="w-full">
      {[0, top / 2, top].map((t) => (
        <g key={t}>
          <line x1={L} x2={W - 4} y1={y(t)} y2={y(t)} stroke="var(--color-line)" />
          <text x={L - 6} y={y(t) + 3} textAnchor="end" fontSize="10" fill="var(--color-muted)">
            {t.toLocaleString("en-IN")}
          </text>
        </g>
      ))}
      {days.map((d, i) => {
        const g = totals[i] ?? 0;
        const last = i === days.length - 1;
        const h = Math.max(0, H - T - B - (y(g / 1000) - T));
        return (
          <g key={d.date}>
            <rect x={L + i * bw + 1.5} y={y(g / 1000)} width={Math.max(1, bw - 3)} height={h} rx="2" fill={last ? "var(--color-caramel)" : "var(--color-roast)"} opacity={last ? 1 : 0.75}>
              <title>
                {shortDate(d.date)}: {kgText(g)}
              </title>
            </rect>
            {(i % 3 === 0 || last) && (
              <text x={L + i * bw + bw / 2} y={H - 6} textAnchor="middle" fontSize="10" fill="var(--color-muted)">
                {shortDate(d.date)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

const sumKg = (list: string[]) => formatKg(list.reduce((s, k) => s + parseKg(k), 0));

/** One dashboard per estate in scope. "All estates" fetches each and adds them up. */
export function useDashboards(all = false) {
  const app = useApp();
  const estates = app.ref?.estates ?? [];
  const scope = all || (app.allEstates && estates.length > 1) ? estates : estates.filter((e) => e.id === app.estateId);
  const results = useQueries({
    queries: scope.map((e) => ({
      queryKey: ["dashboard", e.id, app.date],
      queryFn: () => api<DashboardData>(`/estates/${e.id}/reports/dashboard/${app.date}`),
      enabled: app.online && app.can("reports.read", e.id),
      refetchInterval: 60_000,
    })),
  });
  const list = results.flatMap((r) => (r.data ? [r.data] : []));
  return { scope, list, loading: results.some((r) => r.isLoading), failed: results.some((r) => r.error) || (!results.some((r) => r.isLoading) && list.length === 0 && scope.length > 0) };
}

function merge(list: DashboardData[]): DashboardData {
  const first = list[0] as DashboardData;
  if (list.length === 1) return first;
  const n = (f: (d: DashboardData) => number) => list.reduce((s, d) => s + f(d), 0);
  const states = new Set(list.map((d) => d.today.sheetState));
  const expected = sumKg(list.map((d) => d.season.expectedKg));
  const coffee = sumKg(list.map((d) => d.season.coffeeNetKg));
  const start = list.find((d) => d.season.startDate)?.season.startDate ?? null;
  return {
    basis: "server-accepted",
    estate: { id: "ALL", name: "All estates" },
    season: { startDate: start, coffeeNetKg: coffee, expectedKg: expected, percent: start && parseKg(expected) > 0 ? Math.min(999, Math.round((parseKg(coffee) / parseKg(expected)) * 100)) : null },
    today: {
      sheetState: states.size === 1 ? first.today.sheetState : "MIXED",
      activeWorkers: n((d) => d.today.activeWorkers),
      marked: n((d) => d.today.marked),
      present: n((d) => d.today.present),
      halfDayCount: n((d) => d.today.halfDayCount),
      absent: n((d) => d.today.absent),
      weighIns: n((d) => d.today.weighIns),
      coffeeNetKg: sumKg(list.map((d) => d.today.coffeeNetKg)),
      pepperNetKg: sumKg(list.map((d) => d.today.pepperNetKg)),
      dailyLogReadings: n((d) => d.today.dailyLogReadings),
    },
    days: first.days.map((day, i) => ({
      date: day.date,
      coffeeNetKg: "",
      pepperNetKg: "",
      coffeeNetG: list.reduce((s, d) => s + (d.days[i]?.coffeeNetG ?? 0), 0),
      pepperNetG: list.reduce((s, d) => s + (d.days[i]?.pepperNetG ?? 0), 0),
    })),
    attention: {
      sheetsAwaitingApproval: [],
      openConflicts: n((d) => d.attention.openConflicts),
      devicesWaiting: n((d) => d.attention.devicesWaiting),
      entriesWaitingOnDevices: n((d) => d.attention.entriesWaitingOnDevices),
    },
  };
}

export type DashboardPage = "attendance" | "weighin" | "dailylog" | "summary" | "sync" | "manage";

export function Dashboard({ go }: { go: (page: DashboardPage) => void }) {
  const app = useApp();
  const { pepper } = useCrops();
  const { scope, list, loading, failed } = useDashboards();
  const multi = scope.length > 1;
  const d = list.length ? merge(list) : undefined;
  const title = multi ? "All estates" : (scope[0]?.name ?? "Dashboard");

  type Item = { tone: "bad" | "warn" | "info"; title: string; detail: string; page: DashboardPage };
  const items: Item[] = [];
  for (const x of list) {
    const who = multi ? `${x.estate.name}: ` : "";
    if (app.can("attendance.approve", x.estate.id))
      for (const s of x.attention.sheetsAwaitingApproval)
        items.push({ tone: "info", title: `${who}Attendance for ${shortDate(s.date)} is waiting for approval`, detail: "Open the register to approve it or send it back.", page: "attendance" });
    if (x.today.sheetState === "NOT_STARTED")
      items.push({ tone: "info", title: `${who}Today's attendance has not been started`, detail: "Supervisors fill the register from their phones.", page: "attendance" });
    if (x.today.dailyLogReadings === 0) items.push({ tone: "info", title: `${who}No daily log readings yet today`, detail: "Readings appear after a supervisor records them.", page: "dailylog" });
  }
  if (d) {
    if (d.attention.openConflicts > 0)
      items.unshift({
        tone: "bad",
        title: `${d.attention.openConflicts} entr${d.attention.openConflicts === 1 ? "y needs" : "ies need"} a decision`,
        detail: "Two phones recorded the same thing differently. A manager keeps one version, with a reason.",
        page: "manage",
      });
    if (d.attention.entriesWaitingOnDevices > 0)
      items.unshift({
        tone: "warn",
        title: `${d.attention.entriesWaitingOnDevices} entries are still on ${d.attention.devicesWaiting === 1 ? "a supervisor phone" : `${d.attention.devicesWaiting} supervisor phones`}`,
        detail: "They count here only after the phone syncs.",
        page: "sync",
      });
  }
  if (app.queue.waiting > 0) items.unshift({ tone: "warn", title: `${app.queue.waiting} entries are waiting on this phone`, detail: "Open Sync to send them when there is signal.", page: "sync" });
  if (app.queue.rejected > 0) items.unshift({ tone: "bad", title: `${app.queue.rejected} entries were not accepted`, detail: "Open Sync to see why and fix or remove them.", page: "sync" });

  const season = d?.season;
  const sheetText = d ? (d.today.sheetState === "MIXED" ? "Differs by estate" : (SHEET_TEXT[d.today.sheetState] ?? d.today.sheetState)) : "";

  return (
    <div className="flex flex-col gap-4">
      <div className="lg:flex lg:flex-wrap lg:items-baseline lg:gap-x-4">
        <h1>{title}</h1>
        <p className="mt-1 lg:mt-0 text-sm text-muted">The last 14 days up to {longDate(app.date)}. Figures count only what the server has received.</p>
      </div>

      {!app.online && <Notice tone="warn">No signal. The dashboard needs the server, so it is not shown. {app.queue.waiting} entries are waiting on this phone.</Notice>}
      {app.online && loading && <p>Loading…</p>}
      {app.online && !loading && failed && <Notice tone="bad">Could not load the dashboard.</Notice>}

      {d && season && (
        <>
          <div className={`grid overflow-hidden rounded-2xl border border-line bg-surface sm:grid-cols-2 ${pepper ? "lg:grid-cols-5" : "lg:grid-cols-4"}`}>
            <Kpi
              label="Workers today"
              value={
                <>
                  {d.today.present} <span className="text-sm font-normal text-muted">of {d.today.activeWorkers}</span>
                </>
              }
              note={`${d.today.halfDayCount} half day · ${d.today.absent} absent · ${sheetText}`}
            />
            <Kpi label="Coffee weighed today" value={`${d.today.coffeeNetKg} kg`} note={`${d.today.weighIns} weigh-ins in all`} />
            {pepper && <Kpi label="Pepper weighed today" value={`${d.today.pepperNetKg} kg`} note="Net weight, same weigh-in" />}
            <Kpi
              label="Season to date"
              value={season.startDate ? `${Number(season.coffeeNetKg).toLocaleString("en-IN", { maximumFractionDigits: 0 })} kg` : "–"}
              note={
                season.startDate ? (
                  season.percent === null ? (
                    "No expected cherry entered for the fields"
                  ) : (
                    <>
                      <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-surface-2">
                        <span className="block h-full rounded-full bg-roast" style={{ width: `${Math.min(100, season.percent)}%` }} />
                      </span>
                      {season.percent}% of {Number(season.expectedKg).toLocaleString("en-IN", { maximumFractionDigits: 0 })} kg expected
                    </>
                  )
                ) : app.canAny("settings.configure") ? (
                  "Set the season start under Manage › Setup"
                ) : (
                  "The season dates are not set yet"
                )
              }
            />
            <Kpi label="Daily log today" value={d.today.dailyLogReadings} note="Readings recorded" />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Needs attention" actions={<span className="text-sm text-muted">{items.length === 0 ? "All clear" : `${items.length} item${items.length === 1 ? "" : "s"}`}</span>}>
              {items.length === 0 ? (
                <p className="flex items-center gap-2 text-muted">
                  <Icon name="check" className="h-5 w-5 text-ok" /> Nothing needs attention.
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {items.slice(0, 8).map((it) => (
                    <li
                      key={it.title}
                      className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2 ${it.tone === "bad" ? "border-bad/40 bg-bad/10" : it.tone === "warn" ? "border-warn/40 bg-warn/10" : "border-line bg-bg"}`}
                    >
                      <div className="min-w-0">
                        <p className="font-semibold">{it.title}</p>
                        <p className="text-sm text-muted">{it.detail}</p>
                      </div>
                      <button type="button" onClick={() => go(it.page)} className="min-h-9 shrink-0 rounded-lg border border-line bg-surface px-3 text-sm font-semibold hover:bg-bg">
                        Open
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card title="Weighed in per day" actions={<span className="text-sm text-muted">{pepper ? "Net kg, coffee and pepper" : "Net kg of coffee"}</span>}>
              <DailyChart days={d.days} pepper={pepper} />
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
