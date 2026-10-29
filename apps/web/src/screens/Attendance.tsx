import { uuidv7 } from "@cemms/domain";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useApp } from "../app-context";
import { Button, Card, FilterBar, FilterSelect, Input, Notice, Select, StatusBadge } from "../components/ui";
import { ApiError, api } from "../lib/api";
import { db, getMeta, type LocalRecord, setMeta } from "../lib/db";
import { useLive } from "../lib/hooks";
import { queueChange } from "../lib/outbox";
import { CorrectRecord, WorkerHistory } from "./AttendanceExtras";

interface ServerRecord {
  id: string;
  workerId: string;
  statusCode: string;
  dayFraction: "FULL" | "HALF" | null;
  fieldId: string | null;
  jobTypeId: string | null;
  remarks: string | null;
  version: number;
}
interface StatusDef {
  code: string;
  label: string;
  active: boolean;
  requiresAssignment: boolean;
}
interface SheetResponse {
  otherShift?: { shift: "DAY" | "NIGHT"; present: { workerId: string; fieldId: string | null; jobTypeId: string | null; dayFraction: "FULL" | "HALF" | null }[] };
  sheet: { id: string | null; state: "DRAFT" | "SUBMITTED" | "APPROVED"; version: number; returnedReason?: string | null };
  records: ServerRecord[];
  prefill: { fromDate: string | null; assignments: { workerId: string; fieldId: string; jobTypeId: string; dayFraction: "FULL" | "HALF" | null }[] };
  statuses: StatusDef[];
  approvalRequired: boolean;
  openConflicts: number;
}
type Prefill = SheetResponse["prefill"];
type Draft = { dayFraction: "FULL" | "HALF"; fieldId: string | null; jobTypeId: string | null };

/** The status buttons of the register, in the order of the prototype: P, half, A, L, Off, Hol. */
const CHIPS = [
  { id: "P", short: "P", long: "Present, full day", statusCode: "PRESENT", dayFraction: "FULL" as const },
  { id: "H", short: "½", long: "Half day", statusCode: "PRESENT", dayFraction: "HALF" as const },
  { id: "A", short: "A", long: "Absent", statusCode: "ABSENT", dayFraction: null },
  { id: "L", short: "L", long: "Leave", statusCode: "LEAVE", dayFraction: null },
  { id: "O", short: "Off", long: "Off day", statusCode: "OFF_DAY", dayFraction: null },
  { id: "F", short: "Hol", long: "Holiday", statusCode: "HOLIDAY", dayFraction: null },
];
const DEFAULT_STATUSES: StatusDef[] = [
  { code: "PRESENT", label: "Present", active: true, requiresAssignment: true },
  { code: "ABSENT", label: "Absent", active: true, requiresAssignment: false },
];

export function Attendance() {
  const app = useApp();
  const { ref, estateId, date, session } = app;
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState<{ tone: "ok" | "bad" | "warn"; text: string } | null>(null);
  const [returnReason, setReturnReason] = useState("");
  /** Present marks waiting for a field and a job; nothing is queued until they are complete. */
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const [correcting, setCorrecting] = useState<string | null>(null);
  const [bulkField, setBulkField] = useState("");
  const [bulkJob, setBulkJob] = useState("");
  const [bulkStatus, setBulkStatus] = useState("P");
  /** Day register or Night register (night watchers). Each is marked, submitted and approved on its own. */
  const [shift, setShift] = useState<"DAY" | "NIGHT">("DAY");
  // Filters over the register (they only change what is listed, never what is saved).
  const [fType, setFType] = useState("");
  const [fArea, setFArea] = useState("");
  const [fGender, setFGender] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fField, setFField] = useState("");
  const tenantId = session.user.tenantId;

  const sheet = useQuery({
    queryKey: ["sheet", estateId, date, shift],
    queryFn: () => api<SheetResponse>(`/estates/${estateId}/attendance/${date}?shift=${shift}`),
    enabled: app.online && !!estateId,
    refetchInterval: 60_000,
  });

  // Keep server records on the phone so the register still shows them offline.
  useEffect(() => {
    const data = sheet.data;
    if (!data) return;
    void db.transaction("rw", db.records, db.meta, async () => {
      for (const r of data.records) {
        const key = `attendance_record:${r.id}`;
        const local = await db.records.get(key);
        if (local && local.status === "waiting") continue;
        await db.records.put({
          key,
          tenantId,
          entityType: "attendance_record",
          entityId: r.id,
          estateId,
          businessDate: date,
          data: { businessDate: date, shift, workerId: r.workerId, statusCode: r.statusCode, dayFraction: r.dayFraction, fieldId: r.fieldId, jobTypeId: r.jobTypeId, remarks: r.remarks },
          status: local?.status === "conflict" ? "conflict" : "accepted",
          serverVersion: r.version,
          nextBase: r.version,
          lastMutationId: local?.lastMutationId ?? "",
          updatedAt: new Date().toISOString(),
        });
      }
      await setMeta(`prefill:${estateId}:${date}:${shift}`, data.prefill);
      await setMeta(`sheet:${estateId}:${date}:${shift}`, data.sheet.state);
      await setMeta(`statuses:${estateId}`, data.statuses);
    });
  }, [sheet.data, tenantId, estateId, date]);

  const localAll = useLive(
    () => db.records.where("[tenantId+entityType+estateId+businessDate]").equals([tenantId, "attendance_record", estateId, date]).toArray(),
    [tenantId, estateId, date],
    [] as LocalRecord[],
  );
  const local = useMemo(() => localAll.filter((r) => ((r.data.shift as string | undefined) ?? "DAY") === shift), [localAll, shift]);
  const otherShift = shift === "DAY" ? "NIGHT" : "DAY";
  const otherLocal = useMemo(() => localAll.filter((r) => ((r.data.shift as string | undefined) ?? "DAY") === otherShift), [localAll, otherShift]);
  const prefill = useLive(() => getMeta<Prefill>(`prefill:${estateId}:${date}:${shift}`), [estateId, date, shift], undefined);
  const cachedState = useLive(() => getMeta<SheetResponse["sheet"]["state"]>(`sheet:${estateId}:${date}:${shift}`), [estateId, date, shift], undefined);
  const cachedStatuses = useLive(() => getMeta<StatusDef[]>(`statuses:${estateId}`), [estateId], undefined);
  const sheetState = sheet.data?.sheet.state ?? cachedState ?? "DRAFT";
  const statuses = sheet.data?.statuses ?? cachedStatuses ?? DEFAULT_STATUSES;
  const chips = CHIPS.filter((c) => c.statusCode === "PRESENT" || statuses.some((s) => s.code === c.statusCode && s.active));

  const workers = useMemo(() => (ref?.workers ?? []).filter((w) => (w.estateIds ?? [w.estateId]).includes(estateId)), [ref, estateId]);
  const fields = useMemo(() => (ref?.fields ?? []).filter((f) => f.estateId === estateId), [ref, estateId]);
  const jobs = ref?.jobTypes ?? [];
  /** Workers already present in the other shift today: what they do there, from this phone's marks first, then the server's. */
  const alsoOn = useMemo(() => {
    const m = new Map<string, { fieldId: string | null; jobTypeId: string | null }>();
    for (const r of sheet.data?.otherShift?.present ?? []) m.set(r.workerId, { fieldId: r.fieldId, jobTypeId: r.jobTypeId });
    for (const r of otherLocal) {
      const workerId = r.data.workerId as string;
      if (r.data.statusCode === "PRESENT") m.set(workerId, { fieldId: (r.data.fieldId as string | null) ?? null, jobTypeId: (r.data.jobTypeId as string | null) ?? null });
      else m.delete(workerId);
    }
    return m;
  }, [sheet.data, otherLocal]);
  const byWorker = useMemo(() => {
    const m = new Map<string, LocalRecord>();
    for (const r of local) m.set(r.data.workerId as string, r);
    return m;
  }, [local]);
  const assignment = (workerId: string) => prefill?.assignments.find((a) => a.workerId === workerId);
  const locked = sheetState !== "DRAFT";
  const canCapture = app.can("attendance.capture") && !locked;

  /** What the register shows for a worker: the saved record, or a present mark still missing its field or job. */
  const viewOf = (workerId: string) => {
    const r = byWorker.get(workerId);
    const draft = drafts[workerId];
    const d = { ...((r?.data ?? {}) as Partial<ServerRecord>), ...(draft ? { statusCode: "PRESENT", ...draft } : {}) };
    return { r, draft, d };
  };
  const counts = (() => {
    let P = 0;
    let H = 0;
    let A = 0;
    let O = 0;
    let none = 0;
    let women = 0;
    let men = 0;
    for (const w of workers) {
      const { r, draft, d } = viewOf(w.id);
      if (!r || draft) none++;
      else if (d.statusCode === "PRESENT") {
        d.dayFraction === "HALF" ? H++ : P++;
        if (w.gender === "FEMALE") women++;
        else if (w.gender === "MALE") men++;
      } else if (d.statusCode === "ABSENT" || d.statusCode === "LEAVE") A++;
      else O++;
    }
    return { P, H, A, O, none, women, men };
  })();

  const filtersOn = !!(search || fType || fArea || fGender || fStatus || fField);
  const shown = workers.filter((w) => {
    if (search && !`${w.name} ${w.employeeCode}`.toLowerCase().includes(search.toLowerCase())) return false;
    if (fType && w.employmentType !== fType) return false;
    if (fArea && (w.area ?? "") !== fArea) return false;
    if (fGender && (w.gender ?? "") !== fGender) return false;
    if (fStatus || fField) {
      const { r, draft, d } = viewOf(w.id);
      const state = !r || draft ? "NONE" : d.statusCode === "PRESENT" ? "PRESENT" : d.statusCode === "ABSENT" || d.statusCode === "LEAVE" ? "ABSENT" : "OFF";
      if (fStatus && state !== fStatus) return false;
      if (fField && (state !== "PRESENT" || (fField === "none" ? !!d.fieldId : d.fieldId !== fField))) return false;
    }
    return true;
  });
  const areas = [...new Set(workers.map((w) => w.area).filter((a): a is string => !!a))].sort();
  const clearFilters = () => {
    setSearch("");
    setFType("");
    setFArea("");
    setFGender("");
    setFStatus("");
    setFField("");
  };

  async function mark(workerId: string, change: { statusCode: string; dayFraction?: "FULL" | "HALF" | null; fieldId?: string | null; jobTypeId?: string | null; remarks?: string | null }) {
    const current = byWorker.get(workerId);
    const prev = { ...((current?.data ?? {}) as Partial<ServerRecord>), ...(drafts[workerId] ? { statusCode: "PRESENT", ...drafts[workerId] } : {}) };
    const a = assignment(workerId);
    const present = change.statusCode === "PRESENT";
    const payload = {
      businessDate: date,
      shift,
      workerId,
      statusCode: change.statusCode,
      dayFraction: present ? (change.dayFraction ?? prev.dayFraction ?? a?.dayFraction ?? "FULL") : null,
      fieldId: present ? (change.fieldId ?? prev.fieldId ?? a?.fieldId ?? null) : null,
      jobTypeId: present ? (change.jobTypeId ?? prev.jobTypeId ?? a?.jobTypeId ?? null) : null,
      remarks: change.remarks === undefined ? (prev.remarks ?? null) : change.remarks,
    };
    if (present && (!payload.fieldId || !payload.jobTypeId)) {
      setDrafts((d) => ({ ...d, [workerId]: { dayFraction: payload.dayFraction ?? "FULL", fieldId: payload.fieldId, jobTypeId: payload.jobTypeId } }));
      return;
    }
    setDrafts((d) => {
      if (!d[workerId]) return d;
      const { [workerId]: _, ...rest } = d;
      return rest;
    });
    const worker = workers.find((w) => w.id === workerId);
    const chip = CHIPS.find((c) => c.statusCode === payload.statusCode && (c.dayFraction ?? null) === (payload.dayFraction ?? null));
    await queueChange({
      tenantId,
      userId: session.user.id,
      deviceId: app.deviceId,
      entityType: "attendance_record",
      op: "upsert",
      estateId,
      businessDate: date,
      entityId: current?.entityId,
      payload,
      label: `Attendance: ${worker?.name ?? "worker"} ${chip?.long.toLowerCase() ?? payload.statusCode.toLowerCase()}`,
    });
    void app.sync();
  }

  async function markRest() {
    let done = 0;
    let waiting = 0;
    for (const w of workers) {
      if (byWorker.has(w.id) && !drafts[w.id]) continue;
      const a = assignment(w.id);
      const fieldId = a?.fieldId ?? (bulkField || null);
      const jobTypeId = a?.jobTypeId ?? (bulkJob || null);
      await mark(w.id, { statusCode: "PRESENT", dayFraction: a?.dayFraction ?? "FULL", fieldId, jobTypeId });
      if (fieldId && jobTypeId) done++;
      else waiting++;
    }
    setMessage({
      tone: waiting ? "warn" : "ok",
      text:
        done || waiting
          ? `${done} workers marked present${prefill?.fromDate ? ` with the field and job from ${prefill.fromDate}` : ""}.${waiting ? ` ${waiting} still need a field and a job (choose them in their row).` : " Change anyone who is different."}`
          : "Nobody left to mark.",
    });
  }

  async function bulkAssign() {
    if (!bulkField || !bulkJob) return;
    let skipped = 0;
    for (const id of selected) {
      const { r, d } = viewOf(id);
      if (r && d.statusCode !== "PRESENT") {
        skipped++;
        continue;
      }
      await mark(id, { statusCode: "PRESENT", fieldId: bulkField, jobTypeId: bulkJob });
    }
    setMessage({ tone: skipped ? "warn" : "ok", text: `Field and job set for ${selected.size - skipped} workers.${skipped ? ` ${skipped} who are not working that day were left as they are.` : ""}` });
    setSelected(new Set());
  }

  async function bulkSetStatus() {
    const chip = chips.find((c) => c.id === bulkStatus);
    if (!chip) return;
    for (const id of selected) await mark(id, { statusCode: chip.statusCode, dayFraction: chip.dayFraction, fieldId: bulkField || undefined, jobTypeId: bulkJob || undefined });
    setMessage({ tone: "ok", text: `${selected.size} workers set to ${chip.long.toLowerCase()}.` });
    setSelected(new Set());
  }

  async function submitDay() {
    const extra = counts.none ? ` ${counts.none} workers are not marked and will be left out.` : "";
    if (!window.confirm(`Submit ${shift === "NIGHT" ? "night " : ""}attendance for ${date}? After this, changes need a manager.${extra}`)) return;
    await queueChange({
      tenantId,
      userId: session.user.id,
      deviceId: app.deviceId,
      entityType: "attendance_sheet",
      op: "submit",
      estateId,
      businessDate: date,
      entityId: uuidv7(),
      payload: { businessDate: date, shift },
      label: `Submit ${shift === "NIGHT" ? "night " : ""}attendance ${date}`,
      keepRecord: false,
    });
    setMessage({ tone: "ok", text: "Submission saved on this phone. It reaches the office when the phone syncs." });
    await app.sync();
    void qc.invalidateQueries({ queryKey: ["sheet", estateId, date] });
  }

  async function managerAction(action: "approve" | "return") {
    try {
      await api(`/estates/${estateId}/attendance/${date}/actions`, { body: { action, shift, ...(action === "return" ? { reason: returnReason } : {}) } });
      setMessage({ tone: "ok", text: action === "approve" ? "Attendance approved." : "Sent back to the supervisor." });
      setReturnReason("");
      void qc.invalidateQueries({ queryKey: ["sheet", estateId, date] });
    } catch (e) {
      setMessage({ tone: "bad", text: e instanceof ApiError ? e.message : "Could not reach the server." });
    }
  }

  if (!ref) return <Notice>Connect to the internet once to download the worker and field lists.</Notice>;

  const allSelected = shown.length > 0 && shown.every((w) => selected.has(w.id));
  const fieldCounts = new Map<string, { name: string; workers: number }>();
  for (const w of workers) {
    const { r, d } = viewOf(w.id);
    if (r && d.statusCode === "PRESENT" && d.fieldId) {
      const f = fields.find((x) => x.id === d.fieldId);
      const cur = fieldCounts.get(d.fieldId) ?? { name: f?.name ?? "Field", workers: 0 };
      cur.workers++;
      fieldCounts.set(d.fieldId, cur);
    }
  }
  const gridCols = "md:grid-cols-[2rem_minmax(9rem,1.2fr)_9.5rem_minmax(8rem,1fr)_minmax(7rem,0.8fr)_minmax(7rem,1fr)]";

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1>Attendance</h1>
        <fieldset className="mt-2 m-0 inline-flex min-w-0 gap-1 rounded-lg border border-line bg-surface p-1">
          <legend className="sr-only">Register</legend>
          {(["DAY", "NIGHT"] as const).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={shift === s}
              onClick={() => {
                setShift(s);
                setSelected(new Set());
                setDrafts({});
              }}
              className={`min-h-10 rounded-md px-4 text-sm font-semibold ${shift === s ? "bg-roast text-roast-ink" : "text-muted"}`}
            >
              {s === "DAY" ? "Day" : "Night"}
            </button>
          ))}
        </fieldset>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          One register per estate per day, plus a Night register for night watchers. Each worker gets a status, a field from the field list and a job. It starts with the previous day's fields and
          jobs, so only changes need entering.
        </p>
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-bg px-2 py-1 text-xs font-semibold">{sheetState === "DRAFT" ? "Draft" : sheetState === "SUBMITTED" ? "Submitted" : "Approved"}</span>
          <small className="text-muted">
            {counts.P} present · {counts.H} half day · {counts.A} absent or leave{counts.O ? ` · ${counts.O} off or holiday` : ""}
            {counts.none && shift === "DAY" ? (
              <>
                {" · "}
                <b className="text-ink">{counts.none} not marked</b>
              </>
            ) : null}
          </small>
          {counts.women + counts.men > 0 && (
            <small className="w-full text-muted">
              {counts.women} {counts.women === 1 ? "woman" : "women"}, {counts.men} {counts.men === 1 ? "man" : "men"} working
            </small>
          )}
          <span className="flex-1" />
          {canCapture && (
            <Button variant="secondary" onClick={markRest} disabled={counts.none === 0}>
              Mark the rest present
            </Button>
          )}
          {canCapture && app.can("attendance.submit") && (
            <Button onClick={submitDay} disabled={counts.P + counts.H + counts.A + counts.O === 0}>
              {counts.none && shift === "DAY" ? `Submit (${counts.none} not marked)` : "Submit for approval"}
            </Button>
          )}
          {app.can("attendance.approve") && app.online && sheetState === "SUBMITTED" && (
            <>
              <Button onClick={() => managerAction("approve")}>Approve attendance</Button>
              <Input aria-label="Reason for sending back" placeholder="Reason for sending back" value={returnReason} onChange={(e) => setReturnReason(e.target.value)} className="max-w-xs" />
              <Button variant="secondary" disabled={returnReason.trim().length < 3} onClick={() => managerAction("return")}>
                Send back
              </Button>
            </>
          )}
        </div>
        {!app.online && (
          <div className="mt-3">
            <Notice tone="warn">No signal. Marks are saved on this phone and upload later.</Notice>
          </div>
        )}
        {sheet.data?.sheet.returnedReason && sheetState === "DRAFT" && (
          <div className="mt-3">
            <Notice tone="warn">Sent back: {sheet.data.sheet.returnedReason}</Notice>
          </div>
        )}
        {(sheet.data?.openConflicts ?? 0) > 0 && (
          <div className="mt-3">
            <Notice tone="warn">{sheet.data?.openConflicts} worker(s) were marked on two phones. A manager must choose which entry to keep (Manage → Conflicts).</Notice>
          </div>
        )}
        {message && (
          <div className="mt-3">
            <Notice tone={message.tone}>{message.text}</Notice>
          </div>
        )}
        {locked && (
          <p className="mt-3 text-sm text-muted">
            This day is {sheetState === "SUBMITTED" ? "submitted" : "approved"}. Changes now go through a manager's correction with a reason; the old entry is kept in the history.
          </p>
        )}

        {canCapture && (
          <fieldset className="mt-4 flex flex-wrap items-center gap-2 rounded-xl bg-surface-2 p-3">
            <legend className="sr-only">Change selected workers together</legend>
            <b className="text-sm">{selected.size ? `${selected.size} selected` : "Select workers to change them together"}</b>
            <span className="flex items-center gap-1 text-sm text-muted">
              Field
              <Select aria-label="Field for the selected workers" value={bulkField} onChange={(e) => setBulkField(e.target.value)} className="min-w-36" disabled={!selected.size}>
                <option value="">Choose…</option>
                {fields.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </Select>
            </span>
            <span className="flex items-center gap-1 text-sm text-muted">
              Job
              <Select aria-label="Job for the selected workers" value={bulkJob} onChange={(e) => setBulkJob(e.target.value)} className="min-w-32" disabled={!selected.size}>
                <option value="">Choose…</option>
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.name}
                  </option>
                ))}
              </Select>
            </span>
            <Button size="sm" disabled={!selected.size || !bulkField || !bulkJob} onClick={bulkAssign}>
              Assign field and job
            </Button>
            <span className="mx-1 hidden h-6 w-px bg-line md:block" aria-hidden="true" />
            <span className="flex items-center gap-1 text-sm text-muted">
              Status
              <Select aria-label="Status for the selected workers" value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value)} className="min-w-32" disabled={!selected.size}>
                {chips.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.long}
                  </option>
                ))}
              </Select>
            </span>
            <Button size="sm" variant="secondary" disabled={!selected.size} onClick={bulkSetStatus}>
              Set status
            </Button>
            {selected.size > 0 && (
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                Clear selection
              </Button>
            )}
          </fieldset>
        )}

        <div className="mt-3 max-w-sm">
          <label className="text-sm font-semibold" htmlFor="search">
            Find a worker
          </label>
          <Input id="search" type="search" placeholder="Name or code" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="mt-3">
          <FilterBar shown={shown.length} total={workers.length} noun="workers" active={filtersOn} onClear={clearFilters}>
            <FilterSelect
              label="Worker status"
              value={fType}
              onChange={setFType}
              options={[
                { value: "", label: "All types" },
                { value: "PERMANENT", label: "Permanent" },
                { value: "CASUAL", label: "Casual" },
                { value: "CONTRACT", label: "Contract" },
                { value: "NORTH_INDIAN", label: "North Indian" },
              ]}
            />
            <FilterSelect label="Area" value={fArea} onChange={setFArea} options={[{ value: "", label: "All areas" }, ...areas.map((a) => ({ value: a, label: a }))]} />
            <FilterSelect
              label="Gender"
              value={fGender}
              onChange={setFGender}
              options={[
                { value: "", label: "Everyone" },
                { value: "FEMALE", label: "Women" },
                { value: "MALE", label: "Men" },
              ]}
            />
            <FilterSelect
              label="Today's mark"
              value={fStatus}
              onChange={setFStatus}
              options={[
                { value: "", label: "All" },
                { value: "NONE", label: "Not marked" },
                { value: "PRESENT", label: "Present or half day" },
                { value: "ABSENT", label: "Absent or leave" },
                { value: "OFF", label: "Off or holiday" },
              ]}
            />
            <FilterSelect
              label="Field"
              value={fField}
              onChange={setFField}
              options={[{ value: "", label: "All fields" }, ...fields.map((f) => ({ value: f.id, label: f.name })), { value: "none", label: "No field set" }]}
            />
          </FilterBar>
        </div>
      </Card>

      <div className="rounded-2xl border border-line bg-surface">
        <div className={`hidden items-center gap-2 border-b border-line px-3 py-2 text-sm font-semibold text-muted md:grid ${gridCols}`}>
          <input
            type="checkbox"
            aria-label="Select all workers"
            checked={allSelected}
            disabled={!canCapture}
            onChange={(e) => setSelected(e.target.checked ? new Set(shown.map((w) => w.id)) : new Set())}
          />
          <span>Worker</span>
          <span>Status</span>
          <span>Field</span>
          <span>Job</span>
          <span>Remark</span>
        </div>
        <ul aria-label="Workers" className="divide-y divide-line">
          {shown.map((w) => {
            const { r, draft, d } = viewOf(w.id);
            const present = d.statusCode === "PRESENT";
            const showAssign = !r || present;
            const a = assignment(w.id);
            return (
              <li key={w.id} className={`grid gap-2 px-3 py-3 md:items-center ${gridCols} ${selected.has(w.id) ? "bg-bg" : ""}`}>
                <input
                  type="checkbox"
                  aria-label={`Select ${w.name}`}
                  disabled={!canCapture}
                  checked={selected.has(w.id)}
                  onChange={(e) => {
                    const next = new Set(selected);
                    if (e.target.checked) next.add(w.id);
                    else next.delete(w.id);
                    setSelected(next);
                  }}
                />
                <div className="flex items-center justify-between gap-2 md:block">
                  <p className="font-semibold">
                    <span className="font-mono text-sm text-muted">{w.employeeCode}</span> {w.name}
                    {w.gender && (
                      <span className={`ml-2 rounded-full px-2 py-0.5 align-middle text-xs font-medium ${w.gender === "FEMALE" ? "bg-cherry/15 text-cherry" : "bg-info/15 text-info"}`}>
                        {w.gender === "FEMALE" ? "Woman" : "Man"}
                      </span>
                    )}
                    {w.employmentType && (
                      <span className={`ml-2 rounded-full px-2 py-0.5 align-middle text-xs font-medium ${w.employmentType === "PERMANENT" ? "bg-surface-2 text-muted" : "bg-warn/15 text-warn"}`}>
                        {w.employmentType === "PERMANENT" ? "Permanent" : w.employmentType === "CASUAL" ? "Casual" : w.employmentType === "CONTRACT" ? "Contract" : "North Indian"}
                      </span>
                    )}
                  </p>
                  {w.area && <p className="text-xs text-muted">{w.area}</p>}
                  {alsoOn.has(w.id) && (
                    <p className="text-xs font-medium text-info">
                      Also on {otherShift === "DAY" ? "Day" : "Night"}:{" "}
                      {[jobs.find((j) => j.id === alsoOn.get(w.id)?.jobTypeId)?.name, fields.find((f) => f.id === alsoOn.get(w.id)?.fieldId)?.name].filter(Boolean).join(", ") || "present"}
                    </p>
                  )}
                  <div className="text-sm">
                    <span className="mr-2 inline-flex gap-1">
                      <button type="button" className="min-h-8 px-1 text-xs font-medium text-roast hover:underline" aria-label={`History of ${w.name}`} onClick={() => setHistoryFor(w.id)}>
                        History
                      </button>
                      {locked && r?.status === "accepted" && app.can("attendance.correct") && app.online && (
                        <button type="button" className="min-h-8 px-1 text-xs font-medium text-roast hover:underline" aria-label={`Correct ${w.name}`} onClick={() => setCorrecting(w.id)}>
                          Correct
                        </button>
                      )}
                    </span>
                    {draft ? <span className="font-semibold text-warn">Choose field and job</span> : r ? <StatusBadge status={r.status} compact /> : <span className="text-muted">Not marked</span>}
                  </div>
                </div>
                <fieldset className="flex flex-wrap gap-1">
                  <legend className="sr-only">Attendance for {w.name}</legend>
                  {chips.map((c) => {
                    const on = d.statusCode === c.statusCode && (c.dayFraction === null || (c.dayFraction === "HALF" ? d.dayFraction === "HALF" : d.dayFraction !== "HALF"));
                    return (
                      <button
                        key={c.id}
                        type="button"
                        title={c.long}
                        aria-label={c.long}
                        aria-pressed={on}
                        disabled={!canCapture}
                        onClick={() => mark(w.id, { statusCode: c.statusCode, dayFraction: c.dayFraction })}
                        className={`min-h-11 min-w-11 rounded-lg border px-2 text-sm font-semibold transition-colors disabled:opacity-50 md:min-h-9 md:min-w-9 ${on ? "border-roast bg-roast text-roast-ink" : "border-line bg-bg text-ink hover:bg-surface"}`}
                      >
                        {c.short}
                      </button>
                    );
                  })}
                </fieldset>
                {showAssign ? (
                  <Select
                    aria-label={`Field for ${w.name}`}
                    value={d.fieldId ?? a?.fieldId ?? ""}
                    disabled={!canCapture}
                    onChange={(e) => mark(w.id, { statusCode: "PRESENT", fieldId: e.target.value })}
                  >
                    <option value="">Field…</option>
                    {fields.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <span className="hidden text-muted md:block">–</span>
                )}
                {showAssign ? (
                  <Select
                    aria-label={`Job for ${w.name}`}
                    value={d.jobTypeId ?? a?.jobTypeId ?? ""}
                    disabled={!canCapture}
                    onChange={(e) => mark(w.id, { statusCode: "PRESENT", jobTypeId: e.target.value })}
                  >
                    <option value="">Job…</option>
                    {jobs.map((j) => (
                      <option key={j.id} value={j.id}>
                        {j.name}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <span className="hidden text-muted md:block">–</span>
                )}
                <Input
                  key={`${w.id}-${r?.nextBase ?? 0}`}
                  aria-label={`Remark for ${w.name}`}
                  placeholder="Remark"
                  maxLength={500}
                  defaultValue={(d.remarks as string | null) ?? ""}
                  disabled={!canCapture || !r}
                  onBlur={(e) => {
                    const value = e.target.value.trim();
                    if (r && value !== ((d.remarks as string | null) ?? "")) void mark(w.id, { statusCode: d.statusCode ?? "PRESENT", dayFraction: d.dayFraction ?? null, remarks: value || null });
                  }}
                />
                {r?.message && r.status !== "accepted" && <p className="text-sm text-bad md:col-span-6">{r.message}</p>}
              </li>
            );
          })}
        </ul>
        {shown.length === 0 && (
          <div className="p-3">
            <Notice>{filtersOn ? "No workers match these filters." : "No workers match. Workers come from the master list (Manage → Import)."}</Notice>
          </div>
        )}
      </div>

      <Card title="Workers by field">
        {fieldCounts.size === 0 ? (
          <p className="text-muted">No one is marked present yet.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-muted">
                <th className="py-1">Field</th>
                <th className="text-right">Workers</th>
              </tr>
            </thead>
            <tbody>
              {[...fieldCounts.values()]
                .sort((x, y) => y.workers - x.workers)
                .map((f) => (
                  <tr key={f.name} className="border-t border-line">
                    <td className="py-1">{f.name}</td>
                    <td className="text-right font-semibold">{f.workers}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </Card>
      {historyFor && <WorkerHistory estateId={estateId} workerId={historyFor} onClose={() => setHistoryFor(null)} />}
      {correcting &&
        (() => {
          const w = workers.find((x) => x.id === correcting);
          const rec = byWorker.get(correcting);
          if (!w || !rec) return null;
          return (
            <CorrectRecord
              estateId={estateId}
              date={date}
              recordId={rec.entityId}
              baseVersion={rec.nextBase}
              workerName={`${w.employeeCode} ${w.name}`}
              current={rec.data as { statusCode?: string; dayFraction?: "FULL" | "HALF" | null; fieldId?: string | null; jobTypeId?: string | null; remarks?: string | null }}
              chips={chips}
              fields={fields}
              jobs={ref?.jobTypes ?? []}
              onClose={() => setCorrecting(null)}
            />
          );
        })()}
    </div>
  );
}
