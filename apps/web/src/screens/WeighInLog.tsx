import { formatKg } from "@cemms/domain";
import { type ReactNode, useMemo, useState } from "react";
import { Button, Card, FilterBar, FilterDate, FilterSearch, FilterSelect, Notice, StatusBadge } from "../components/ui";
import type { LocalRecord } from "../lib/db";

/** One weigh-in as the day's table shows it: the server's copy, or this phone's copy while it waits. */
export interface LogRow {
  id: string;
  businessDate: string;
  workerId: string;
  fieldId: string;
  varietyId: string | null;
  crop: string;
  bags: number | null;
  remarks: string | null;
  grossG: number | null;
  tareG: number | null;
  netG: number | null;
  status: LocalRecord["status"];
  voided: boolean;
  message?: string;
  version: number;
}

interface Named {
  id: string;
  name: string;
}

type SortKey = "date" | "worker" | "field" | "variety" | "bags" | "gross" | "tare" | "net" | "status";
type Sort = { key: SortKey; dir: "asc" | "desc" } | null;

const dayText = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
const kg = (g: number | null) => (g === null ? "?" : formatKg(g));
const kgShort = (g: number) => `${(g / 1000).toLocaleString("en-IN", { maximumFractionDigits: 1 })} kg`;

/** Horizontal bars with the value written next to each, so the figures never depend on the bar alone. */
function Bars({ items, label }: { items: { label: string; g: number; note?: string }[]; label: string }) {
  const max = Math.max(1, ...items.map((i) => i.g));
  if (items.length === 0) return <p className="text-muted">No accepted weigh-ins yet.</p>;
  return (
    <ul aria-label={label} className="flex flex-col gap-2">
      {items.map((i) => (
        <li key={i.label} className="grid grid-cols-[minmax(6rem,11rem)_1fr_auto] items-center gap-3 text-sm">
          <span className="truncate" title={i.label}>
            {i.label}
            {i.note && <span className="block truncate text-xs text-muted">{i.note}</span>}
          </span>
          <span className="h-3 rounded-full bg-surface-2" aria-hidden="true">
            <span className="block h-3 rounded-full bg-roast" style={{ width: `${Math.max(2, (i.g / max) * 100)}%` }} />
          </span>
          <span className="text-right tabular-nums">{kgShort(i.g)}</span>
        </li>
      ))}
    </ul>
  );
}

export function WeighInLog({
  rows,
  workers,
  fields,
  varieties,
  pepper,
  from,
  to,
  onRange,
  loading,
  problem,
  canEdit,
  canCancel,
  onEdit,
  onCancel,
}: {
  rows: LogRow[];
  workers: { id: string; name: string; employeeCode: string }[];
  fields: Named[];
  varieties: Named[];
  pepper: boolean;
  from: string;
  to: string;
  onRange: (from: string, to: string) => void;
  loading: boolean;
  problem: string | null;
  canEdit: (r: LogRow) => boolean;
  canCancel: (r: LogRow) => boolean;
  onEdit: (id: string) => void;
  onCancel: (r: LogRow, workerName: string) => void;
}) {
  const [q, setQ] = useState("");
  const [field, setField] = useState("");
  const [variety, setVariety] = useState("");
  const [crop, setCrop] = useState("");
  const [state, setState] = useState("");
  const [sort, setSort] = useState<Sort>(null);

  const workerOf = (id: string) => workers.find((w) => w.id === id);
  const fieldName = (id: string) => fields.find((f) => f.id === id)?.name ?? "";
  const varietyName = (id: string | null) => (id ? (varieties.find((v) => v.id === id)?.name ?? "") : "");

  const listed = useMemo(() => {
    const keep = rows.filter((r) => {
      const w = workerOf(r.workerId);
      if (q && !`${w?.name ?? ""} ${w?.employeeCode ?? ""}`.toLowerCase().includes(q.toLowerCase())) return false;
      if (field && r.fieldId !== field) return false;
      if (variety && (variety === "NONE" ? r.varietyId : r.varietyId !== variety)) return false;
      if (crop && r.crop !== crop) return false;
      if (state === "CANCELLED") return r.voided;
      if (state === "ACCEPTED") return r.status === "accepted" && !r.voided;
      if (state === "WAITING") return r.status === "waiting";
      if (state === "PROBLEM") return r.status !== "accepted" && r.status !== "waiting";
      return true;
    });
    // Without a chosen sort, the latest day comes first and each day keeps its order (newest entry first).
    if (!sort) return [...keep].sort((a, b) => (a.businessDate < b.businessDate ? 1 : a.businessDate > b.businessDate ? -1 : 0));
    const value = (r: LogRow): string | number => {
      switch (sort.key) {
        case "date":
          return r.businessDate;
        case "worker":
          return (workerOf(r.workerId)?.name ?? "").toLowerCase();
        case "field":
          return fieldName(r.fieldId).toLowerCase();
        case "variety":
          return varietyName(r.varietyId).toLowerCase();
        case "bags":
          return r.bags ?? -1;
        case "gross":
          return r.grossG ?? -1;
        case "tare":
          return r.tareG ?? -1;
        case "net":
          return r.netG ?? -1;
        case "status":
          return r.voided ? "z-cancelled" : r.status;
      }
    };
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...keep].sort((a, b) => {
      const x = value(a);
      const y = value(b);
      return (x < y ? -1 : x > y ? 1 : 0) * dir;
    });
  }, [rows, q, field, variety, crop, state, sort, workers, fields, varieties]);

  const filtersOn = !!(q || field || variety || crop || state);
  const manyDays = from !== to;
  // Totals and charts count only what the server has accepted; entries still on a phone are listed but not added up.
  const accepted = listed.filter((r) => r.status === "accepted" && !r.voided);
  const sum = (pick: (r: LogRow) => number | null) => accepted.reduce((s, r) => s + (pick(r) ?? 0), 0);

  const dayAccepted = rows.filter((r) => r.status === "accepted" && !r.voided && r.netG !== null);
  const byWorker = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of dayAccepted) m.set(r.workerId, (m.get(r.workerId) ?? 0) + (r.netG ?? 0));
    return [...m.entries()]
      .map(([id, g]) => ({ label: workerOf(id)?.name ?? "Worker", note: workerOf(id)?.employeeCode, g }))
      .sort((a, b) => b.g - a.g)
      .slice(0, 12);
  }, [rows, workers]);
  const byField = useMemo(() => {
    const m = new Map<string, { label: string; note?: string; g: number }>();
    for (const r of dayAccepted) {
      const key = `${r.fieldId}|${r.varietyId ?? ""}`;
      const cur = m.get(key) ?? { label: fieldName(r.fieldId) || "Field", note: varietyName(r.varietyId) || "Variety not recorded", g: 0 };
      cur.g += r.netG ?? 0;
      m.set(key, cur);
    }
    return [...m.values()].sort((a, b) => b.g - a.g).slice(0, 12);
  }, [rows, fields, varieties]);

  const head = (key: SortKey, text: string, right = false): ReactNode => {
    const on = sort?.key === key;
    // The arrow's slot sits on the inner side, so a number column's heading ends exactly where its figures end.
    const arrow = (
      <span aria-hidden="true" className="w-3 text-[0.65rem]">
        {on ? (sort?.dir === "asc" ? "▲" : "▼") : ""}
      </span>
    );
    return (
      <th scope="col" aria-sort={on ? (sort?.dir === "asc" ? "ascending" : "descending") : "none"} className={`px-3 py-2 text-[0.8rem] font-medium text-muted ${right ? "text-right" : "text-left"}`}>
        <button
          type="button"
          className={`inline-flex min-h-9 items-center gap-1 whitespace-nowrap hover:text-ink ${on ? "text-ink" : ""}`}
          onClick={() => setSort(on && sort?.dir === "asc" ? { key, dir: "desc" } : on && sort?.dir === "desc" ? null : { key, dir: "asc" })}
        >
          {right && arrow}
          {text}
          {!right && arrow}
        </button>
      </th>
    );
  };

  return (
    <>
      <Card
        title={manyDays ? "Weigh-ins" : "Weigh-ins for the day"}
        actions={<span className="hidden text-sm text-muted sm:inline">{manyDays ? `${dayText(from)} to ${dayText(to)} · ` : ""}Tap a heading to sort</span>}
      >
        <div className="mb-3">
          <FilterBar
            shown={listed.length}
            total={rows.length}
            noun="weigh-ins"
            active={filtersOn}
            onClear={() => {
              setQ("");
              setField("");
              setVariety("");
              setCrop("");
              setState("");
            }}
          >
            <FilterDate label="From" value={from} onChange={(v) => onRange(v, v > to ? v : to)} />
            <FilterDate label="To" value={to} onChange={(v) => onRange(v < from ? v : from, v)} />
            <FilterSearch label="Find a worker" value={q} onChange={setQ} placeholder="Name or code" />
            <FilterSelect label="Field" value={field} onChange={setField} options={[{ value: "", label: "All fields" }, ...fields.map((f) => ({ value: f.id, label: f.name }))]} />
            <FilterSelect
              label="Variety"
              value={variety}
              onChange={setVariety}
              options={[{ value: "", label: "All varieties" }, ...varieties.map((v) => ({ value: v.id, label: v.name })), { value: "NONE", label: "Not recorded" }]}
            />
            {pepper && (
              <FilterSelect
                label="Crop"
                value={crop}
                onChange={setCrop}
                options={[
                  { value: "", label: "Coffee and pepper" },
                  { value: "COFFEE", label: "Coffee" },
                  { value: "PEPPER", label: "Pepper" },
                ]}
              />
            )}
            <FilterSelect
              label="State"
              value={state}
              onChange={setState}
              options={[
                { value: "", label: "All" },
                { value: "ACCEPTED", label: "Accepted by the office" },
                { value: "WAITING", label: "Waiting on this phone" },
                { value: "PROBLEM", label: "Not accepted or conflict" },
                { value: "CANCELLED", label: "Cancelled" },
              ]}
            />
          </FilterBar>
        </div>
        {problem ? (
          <Notice tone="bad">{problem}</Notice>
        ) : loading && rows.length === 0 ? (
          <p className="py-2 text-muted">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="py-2 text-muted">{manyDays ? "No weigh-ins in these days." : "No weigh-ins yet."}</p>
        ) : listed.length === 0 ? (
          <p className="py-2 text-muted">No weigh-ins match these filters.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[60rem] text-sm">
              <thead className="border-b border-line">
                <tr>
                  {manyDays && head("date", "Date")}
                  {head("worker", "Worker")}
                  {head("field", "Field")}
                  {head("variety", "Variety")}
                  {head("bags", "Bags", true)}
                  {head("gross", "Gross kg", true)}
                  {head("tare", "Tare kg", true)}
                  {head("net", "Net kg", true)}
                  <th scope="col" className="px-3 py-2 text-left text-[0.8rem] font-medium text-muted">
                    Remark
                  </th>
                  {head("status", "Status")}
                  <th scope="col" className="px-3 py-2">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {listed.map((r) => {
                  const w = workerOf(r.workerId);
                  const cancelled = r.voided ? "line-through text-muted" : "";
                  return (
                    <tr key={r.id}>
                      {manyDays && <td className={`whitespace-nowrap px-3 py-2 tabular-nums ${cancelled}`}>{dayText(r.businessDate)}</td>}
                      <td className={`px-3 py-2 ${cancelled}`}>
                        <span className="font-semibold">{w?.name ?? "Worker"}</span>
                        {w && <span className="ml-2 text-xs text-muted">{w.employeeCode}</span>}
                        {pepper && r.crop === "PEPPER" && <span className="ml-2 text-xs text-muted">pepper</span>}
                      </td>
                      <td className={`px-3 py-2 ${cancelled}`}>{fieldName(r.fieldId)}</td>
                      <td className={`px-3 py-2 ${cancelled}`}>{varietyName(r.varietyId) || <span className="text-muted">Not recorded</span>}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${cancelled}`}>{r.bags ?? "?"}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${cancelled}`}>{kg(r.grossG)}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${cancelled}`}>{kg(r.tareG)}</td>
                      <td className={`px-3 py-2 text-right font-semibold tabular-nums ${cancelled}`}>{kg(r.netG)}</td>
                      <td className="max-w-[14rem] truncate px-3 py-2 text-muted" title={r.remarks ?? undefined}>
                        {r.remarks ?? ""}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-col items-start gap-0.5">
                          <StatusBadge status={r.status} compact />
                          {r.voided ? <span className="text-xs text-muted">cancelled</span> : r.status === "accepted" && r.version > 1 ? <span className="text-xs text-muted">corrected</span> : null}
                          {r.message && r.status !== "accepted" && <span className="text-xs text-bad">{r.message}</span>}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right">
                        {canEdit(r) && (
                          <Button size="sm" variant="ghost" aria-label={`Edit ${w?.name ?? "worker"}'s weigh-in`} onClick={() => onEdit(r.id)}>
                            Edit
                          </Button>
                        )}
                        {canCancel(r) && (
                          <Button size="sm" variant="ghost" aria-label={`Cancel ${w?.name ?? "worker"}'s weigh-in`} onClick={() => onCancel(r, w?.name ?? "worker")}>
                            Cancel
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="border-t border-line font-semibold">
                <tr>
                  <td className="px-3 py-2" colSpan={manyDays ? 4 : 3}>
                    Accepted total{filtersOn ? " of the rows shown" : ""} · {accepted.length} weigh-in{accepted.length === 1 ? "" : "s"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{sum((r) => r.bags)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatKg(sum((r) => r.grossG))}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatKg(sum((r) => r.tareG))}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatKg(sum((r) => r.netG))}</td>
                  <td colSpan={3} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <p className="mt-2 text-sm text-muted">Totals add up only what the server has accepted. Weigh-ins still waiting on this phone are listed but not counted.</p>
      </Card>

      <div className="grid items-start gap-4 xl:grid-cols-2">
        <Card title="Net kg by worker" actions={<span className="text-sm text-muted">Top {Math.min(12, byWorker.length)}</span>}>
          <Bars label="Net kilograms by worker" items={byWorker.map((i) => ({ label: i.label, note: i.note, g: i.g }))} />
        </Card>
        <Card title="Net kg by field and variety">
          <Bars label="Net kilograms by field and variety" items={byField} />
        </Card>
      </div>
    </>
  );
}
