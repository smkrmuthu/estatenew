import { useQuery } from "@tanstack/react-query";
import { useApp } from "../app-context";
import { Card, Notice } from "../components/ui";
import { api } from "../lib/api";

interface Summary {
  attendance: {
    sheetState: string;
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

export function Summary() {
  const app = useApp();
  const q = useQuery({
    queryKey: ["summary", app.estateId, app.date],
    queryFn: () => api<Summary>(`/estates/${app.estateId}/reports/daily/${app.date}`),
    enabled: app.online && !!app.estateId && app.can("reports.read"),
  });
  if (!app.online) return <Notice tone="warn">The summary needs signal. {app.queue.waiting} entries are waiting on this phone.</Notice>;
  if (q.isLoading) return <p>Loading…</p>;
  if (q.error || !q.data) return <Notice tone="bad">Could not load the summary.</Notice>;
  const s = q.data;
  return (
    <div className="flex flex-col gap-4">
      <Notice tone={s.sync.entriesWaitingOnDevices > 0 || app.queue.waiting > 0 ? "warn" : "info"}>
        {s.sync.note} {s.sync.entriesWaitingOnDevices > 0 && `${s.sync.entriesWaitingOnDevices} entries are still waiting on ${s.sync.devicesWaiting} phone(s).`}{" "}
        {app.queue.waiting > 0 && `This phone has ${app.queue.waiting} waiting.`}
        {s.sync.openConflicts > 0 && ` ${s.sync.openConflicts} conflict(s) need a manager.`}
      </Notice>
      <Card title={`Attendance · ${app.date}`}>
        <p>
          {s.attendance.present} present ({s.attendance.halfDayCount} half day), {s.attendance.absent} absent, {s.attendance.marked} of {s.attendance.activeWorkers} marked · {s.attendance.manDays}{" "}
          man-days · {s.attendance.sheetState.toLowerCase().replace("_", " ")}
        </p>
        <table className="mt-2 w-full text-left text-sm">
          <thead>
            <tr className="text-muted">
              <th className="py-1">Field</th>
              <th>Job</th>
              <th className="text-right">Workers</th>
              <th className="text-right">Man-days</th>
            </tr>
          </thead>
          <tbody>
            {s.attendance.byFieldJob.map((r) => (
              <tr key={`${r.field}${r.job}`} className="border-t border-line">
                <td className="py-1">{r.field}</td>
                <td>{r.job}</td>
                <td className="text-right">{r.workers}</td>
                <td className="text-right">{r.manDays}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card title="Weigh-in">
        {s.weighIn.byCrop.length === 0 && <p className="text-muted">No weigh-ins yet.</p>}
        <ul>
          {s.weighIn.byCrop.map((c) => (
            <li key={c.crop} className="text-lg">
              {c.crop === "PEPPER" ? "Pepper" : "Coffee"}: <strong>{c.netKg} kg</strong> from {c.workers} {c.workers === 1 ? "worker" : "workers"} ({c.entries}{" "}
              {c.entries === 1 ? "weigh-in" : "weigh-ins"})
            </li>
          ))}
        </ul>
        {s.weighIn.workersWithSeveralEntries > 0 && <p className="text-sm text-muted">{s.weighIn.workersWithSeveralEntries} worker(s) were weighed more than once today.</p>}
      </Card>
      <Card title="Daily log">
        <ul>
          {s.dailyLog.map((r) => (
            <li key={r.readingAt + r.kind}>
              {new Date(r.readingAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · {r.kind}: {r.value} {r.unit ?? ""}
            </li>
          ))}
          {s.dailyLog.length === 0 && <li className="text-muted">No readings yet.</li>}
        </ul>
      </Card>
    </div>
  );
}
