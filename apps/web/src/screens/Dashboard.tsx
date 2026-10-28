import { useQuery } from "@tanstack/react-query";
import { useApp } from "../app-context";
import { Icon } from "../components/Icon";
import { Card, Notice } from "../components/ui";
import { api } from "../lib/api";

interface DashboardData {
  basis: "server-accepted";
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

function Kpi({ label, value, note }: { label: string; value: React.ReactNode; note: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 border-line p-4 [&:not(:first-child)]:border-t sm:[&:not(:first-child)]:border-t-0 sm:[&:not(:first-child)]:border-l">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</span>
      <span className="text-2xl font-semibold tabular-nums leading-tight">{value}</span>
      <span className="text-sm text-muted">{note}</span>
    </div>
  );
}

/** Bars for the last days of accepted weigh-ins; the latest day is highlighted. */
function DailyChart({ days }: { days: DashboardData["days"] }) {
  const W = 600;
  const H = 170;
  const L = 44;
  const B = 22;
  const T = 10;
  const totals = days.map((d) => d.coffeeNetG + d.pepperNetG);
  const maxKg = Math.max(100, ...totals.map((g) => g / 1000));
  const top = Math.ceil(maxKg / 200) * 200;
  const bw = (W - L - 8) / days.length;
  const y = (kg: number) => T + (H - T - B) * (1 - kg / top);
  const kgText = (g: number) => `${(g / 1000).toLocaleString("en-IN", { maximumFractionDigits: 1 })} kg`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Net kilograms weighed in per day, coffee and pepper together" className="w-full">
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

export function Dashboard({ go }: { go: (page: "attendance" | "weighin" | "dailylog" | "summary" | "sync" | "manage") => void }) {
  const app = useApp();
  const estate = app.ref?.estates.find((e) => e.id === app.estateId);
  const q = useQuery({
    queryKey: ["dashboard", app.estateId, app.date],
    queryFn: () => api<DashboardData>(`/estates/${app.estateId}/reports/dashboard/${app.date}`),
    enabled: app.online && !!app.estateId && app.can("reports.read"),
    refetchInterval: 60_000,
  });
  const d = q.data;

  type Item = { tone: "bad" | "warn" | "info"; title: string; detail: string; page: Parameters<typeof go>[0] };
  const items: Item[] = [];
  if (d) {
    for (const s of d.attention.sheetsAwaitingApproval) {
      if (app.can("attendance.approve"))
        items.push({ tone: "info", title: `Attendance for ${shortDate(s.date)} is waiting for approval`, detail: "Open the register to approve it or send it back.", page: "attendance" });
    }
    if (d.attention.openConflicts > 0)
      items.push({
        tone: "bad",
        title: `${d.attention.openConflicts} entr${d.attention.openConflicts === 1 ? "y needs" : "ies need"} a decision`,
        detail: "Two phones recorded the same thing differently. A manager keeps one version, with a reason.",
        page: "manage",
      });
    if (d.attention.entriesWaitingOnDevices > 0)
      items.push({
        tone: "warn",
        title: `${d.attention.entriesWaitingOnDevices} entries are still on ${d.attention.devicesWaiting === 1 ? "a supervisor phone" : `${d.attention.devicesWaiting} supervisor phones`}`,
        detail: "They count here only after the phone syncs.",
        page: "sync",
      });
    if (d.today.sheetState === "NOT_STARTED")
      items.push({ tone: "info", title: "Today's attendance has not been started", detail: "Supervisors fill the register from their phones.", page: "attendance" });
    if (d.today.dailyLogReadings === 0) items.push({ tone: "info", title: "No daily log readings yet today", detail: "Readings appear after a supervisor records them.", page: "dailylog" });
  }
  if (app.queue.waiting > 0) items.unshift({ tone: "warn", title: `${app.queue.waiting} entries are waiting on this phone`, detail: "Open Sync to send them when there is signal.", page: "sync" });
  if (app.queue.rejected > 0) items.unshift({ tone: "bad", title: `${app.queue.rejected} entries were not accepted`, detail: "Open Sync to see why and fix or remove them.", page: "sync" });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1>{estate?.name ?? "Dashboard"}</h1>
        <p className="mt-1 text-sm text-muted">The last 14 days up to {longDate(app.date)}. Figures count only what the server has received.</p>
      </div>

      {!app.online && <Notice tone="warn">No signal. The dashboard needs the server, so it is not shown. {app.queue.waiting} entries are waiting on this phone.</Notice>}
      {app.online && q.isLoading && <p>Loading…</p>}
      {app.online && (q.error || (!q.isLoading && !d)) && <Notice tone="bad">Could not load the dashboard.</Notice>}

      {d && (
        <>
          <div className="grid overflow-hidden rounded-2xl border border-line bg-surface sm:grid-cols-2 lg:grid-cols-4">
            <Kpi
              label="Workers today"
              value={
                <>
                  {d.today.present} <span className="text-sm font-normal text-muted">of {d.today.activeWorkers}</span>
                </>
              }
              note={`${d.today.halfDayCount} half day · ${d.today.absent} absent · ${SHEET_TEXT[d.today.sheetState] ?? d.today.sheetState}`}
            />
            <Kpi label="Coffee weighed today" value={`${d.today.coffeeNetKg} kg`} note={`${d.today.weighIns} weigh-ins in all`} />
            <Kpi label="Pepper weighed today" value={`${d.today.pepperNetKg} kg`} note="Net weight, same weigh-in" />
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
            <Card title="Weighed in per day" actions={<span className="text-sm text-muted">Net kg, coffee and pepper</span>}>
              <DailyChart days={d.days} />
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
