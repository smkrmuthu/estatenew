import { uuidv7 } from "@cemms/domain";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useApp } from "../app-context";
import { Button, Card, Field, Input, Notice, Select, StatusBadge } from "../components/ui";
import { ApiError, api } from "../lib/api";
import { db, getMeta, type LocalRecord, setMeta } from "../lib/db";
import { useLive } from "../lib/hooks";
import { queueChange } from "../lib/outbox";

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
interface SheetResponse {
  sheet: { id: string | null; state: "DRAFT" | "SUBMITTED" | "APPROVED"; version: number; returnedReason?: string | null };
  records: ServerRecord[];
  prefill: { fromDate: string | null; assignments: { workerId: string; fieldId: string; jobTypeId: string; dayFraction: "FULL" | "HALF" | null }[] };
  statuses: { code: string; label: string; active: boolean; requiresAssignment: boolean }[];
  approvalRequired: boolean;
  openConflicts: number;
}
type Prefill = SheetResponse["prefill"];

export function Attendance() {
  const app = useApp();
  const { ref, estateId, date, session } = app;
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState<{ tone: "ok" | "bad" | "warn"; text: string } | null>(null);
  const [returnReason, setReturnReason] = useState("");
  /** Present marks waiting for a field and a job; nothing is queued until they are complete. */
  const [drafts, setDrafts] = useState<Record<string, { dayFraction: "FULL" | "HALF"; fieldId: string | null; jobTypeId: string | null }>>({});
  const tenantId = session.user.tenantId;

  const sheet = useQuery({
    queryKey: ["sheet", estateId, date],
    queryFn: () => api<SheetResponse>(`/estates/${estateId}/attendance/${date}`),
    enabled: app.online && !!estateId,
    refetchInterval: 60_000,
  });

  // Keep server records on the phone so the roll call still shows them offline.
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
          data: { businessDate: date, workerId: r.workerId, statusCode: r.statusCode, dayFraction: r.dayFraction, fieldId: r.fieldId, jobTypeId: r.jobTypeId, remarks: r.remarks },
          status: local?.status === "conflict" ? "conflict" : "accepted",
          serverVersion: r.version,
          nextBase: r.version,
          lastMutationId: local?.lastMutationId ?? "",
          updatedAt: new Date().toISOString(),
        });
      }
      await setMeta(`prefill:${estateId}:${date}`, data.prefill);
      await setMeta(`sheet:${estateId}:${date}`, data.sheet.state);
    });
  }, [sheet.data, tenantId, estateId, date]);

  const local = useLive(
    () => db.records.where("[tenantId+entityType+estateId+businessDate]").equals([tenantId, "attendance_record", estateId, date]).toArray(),
    [tenantId, estateId, date],
    [] as LocalRecord[],
  );
  const prefill = useLive(() => getMeta<Prefill>(`prefill:${estateId}:${date}`), [estateId, date], undefined);
  const cachedState = useLive(() => getMeta<SheetResponse["sheet"]["state"]>(`sheet:${estateId}:${date}`), [estateId, date], undefined);
  const sheetState = sheet.data?.sheet.state ?? cachedState ?? "DRAFT";

  const workers = useMemo(() => (ref?.workers ?? []).filter((w) => w.estateId === estateId), [ref, estateId]);
  const fields = useMemo(() => (ref?.fields ?? []).filter((f) => f.estateId === estateId), [ref, estateId]);
  const jobs = ref?.jobTypes ?? [];
  const byWorker = useMemo(() => {
    const m = new Map<string, LocalRecord>();
    for (const r of local) m.set(r.data.workerId as string, r);
    return m;
  }, [local]);
  const assignment = (workerId: string) => prefill?.assignments.find((a) => a.workerId === workerId);
  const locked = sheetState !== "DRAFT";
  const canCapture = app.can("attendance.capture") && !locked;
  const shown = workers.filter((w) => !search || `${w.name} ${w.employeeCode}`.toLowerCase().includes(search.toLowerCase()));
  const marked = workers.filter((w) => byWorker.has(w.id)).length;

  async function mark(workerId: string, change: { statusCode: string; dayFraction?: "FULL" | "HALF" | null; fieldId?: string | null; jobTypeId?: string | null }) {
    const current = byWorker.get(workerId);
    const prev = { ...((current?.data ?? {}) as Partial<ServerRecord>), ...(drafts[workerId] ? { statusCode: "PRESENT", ...drafts[workerId] } : {}) };
    const a = assignment(workerId);
    const present = change.statusCode === "PRESENT";
    const payload = {
      businessDate: date,
      workerId,
      statusCode: change.statusCode,
      dayFraction: present ? (change.dayFraction ?? prev.dayFraction ?? a?.dayFraction ?? "FULL") : null,
      fieldId: present ? (change.fieldId ?? prev.fieldId ?? a?.fieldId ?? null) : null,
      jobTypeId: present ? (change.jobTypeId ?? prev.jobTypeId ?? a?.jobTypeId ?? null) : null,
      remarks: prev.remarks ?? null,
    };
    if (present && (!payload.fieldId || !payload.jobTypeId)) {
      setDrafts({ ...drafts, [workerId]: { dayFraction: payload.dayFraction ?? "FULL", fieldId: payload.fieldId, jobTypeId: payload.jobTypeId } });
      return;
    }
    if (drafts[workerId]) {
      const { [workerId]: _, ...rest } = drafts;
      setDrafts(rest);
    }
    const worker = workers.find((w) => w.id === workerId);
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
      label: `Attendance: ${worker?.name ?? "worker"} ${payload.statusCode === "PRESENT" ? (payload.dayFraction === "HALF" ? "half day" : "full day") : "absent"}`,
    });
    void app.sync();
  }

  async function markAllFromPrevious() {
    let n = 0;
    for (const w of workers) {
      const a = assignment(w.id);
      if (byWorker.has(w.id) || !a) continue;
      await mark(w.id, { statusCode: "PRESENT", dayFraction: a.dayFraction ?? "FULL", fieldId: a.fieldId, jobTypeId: a.jobTypeId });
      n++;
    }
    setMessage({ tone: "ok", text: n ? `${n} workers marked present with the previous day's field and job. Change anyone who is different.` : "Nobody left to fill from the previous day." });
  }

  async function submitDay() {
    if (!window.confirm(`Submit attendance for ${date}? After this, changes need a manager.`)) return;
    await queueChange({
      tenantId,
      userId: session.user.id,
      deviceId: app.deviceId,
      entityType: "attendance_sheet",
      op: "submit",
      estateId,
      businessDate: date,
      entityId: uuidv7(),
      payload: { businessDate: date },
      label: `Submit attendance ${date}`,
      keepRecord: false,
    });
    setMessage({ tone: "ok", text: "Submission saved on this phone. It reaches the office when the phone syncs." });
    await app.sync();
    void qc.invalidateQueries({ queryKey: ["sheet", estateId, date] });
  }

  async function managerAction(action: "approve" | "return") {
    try {
      await api(`/estates/${estateId}/attendance/${date}/actions`, { body: { action, ...(action === "return" ? { reason: returnReason } : {}) } });
      setMessage({ tone: "ok", text: action === "approve" ? "Attendance approved." : "Sent back to the supervisor." });
      setReturnReason("");
      void qc.invalidateQueries({ queryKey: ["sheet", estateId, date] });
    } catch (e) {
      setMessage({ tone: "bad", text: e instanceof ApiError ? e.message : "Could not reach the server." });
    }
  }

  if (!ref) return <Notice>Connect to the internet once to download the worker and field lists.</Notice>;

  return (
    <div className="flex flex-col gap-4">
      <Card
        title={`Attendance · ${date}`}
        actions={
          <span className="text-sm text-muted">
            {marked} of {workers.length} marked · {sheetState === "DRAFT" ? "Open" : sheetState === "SUBMITTED" ? "Submitted" : "Approved"}
          </span>
        }
      >
        {!app.online && <Notice tone="warn">No signal. Marks are saved on this phone and upload later.</Notice>}
        {sheet.data?.sheet.returnedReason && sheetState === "DRAFT" && <Notice tone="warn">Sent back: {sheet.data.sheet.returnedReason}</Notice>}
        {(sheet.data?.openConflicts ?? 0) > 0 && <Notice tone="warn">{sheet.data?.openConflicts} worker(s) were marked on two phones. A manager must choose which entry to keep.</Notice>}
        {message && <Notice tone={message.tone}>{message.text}</Notice>}
        <div className="mt-3 flex flex-wrap gap-2">
          {canCapture && (
            <Button variant="secondary" onClick={markAllFromPrevious} disabled={!prefill?.assignments.length}>
              Fill from {prefill?.fromDate ?? "previous day"}
            </Button>
          )}
          {canCapture && app.can("attendance.submit") && (
            <Button onClick={submitDay} disabled={marked === 0}>
              Submit day
            </Button>
          )}
          {app.can("attendance.approve") && app.online && sheetState === "SUBMITTED" && (
            <>
              <Button onClick={() => managerAction("approve")}>Approve</Button>
              <Input aria-label="Reason for sending back" placeholder="Reason for sending back" value={returnReason} onChange={(e) => setReturnReason(e.target.value)} className="max-w-xs" />
              <Button variant="secondary" disabled={returnReason.trim().length < 3} onClick={() => managerAction("return")}>
                Send back
              </Button>
            </>
          )}
        </div>
        <div className="mt-3">
          <Field label="Find a worker" htmlFor="search">
            <Input id="search" type="search" placeholder="Name or code" value={search} onChange={(e) => setSearch(e.target.value)} />
          </Field>
        </div>
      </Card>

      <ul className="flex flex-col gap-2" aria-label="Workers">
        {shown.map((w) => {
          const r = byWorker.get(w.id);
          const draft = drafts[w.id];
          const d = { ...((r?.data ?? {}) as Partial<ServerRecord>), ...(draft ? { statusCode: "PRESENT", ...draft } : {}) };
          const present = d.statusCode === "PRESENT";
          const a = assignment(w.id);
          return (
            <li key={w.id} className="rounded-2xl border border-line bg-surface p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-semibold">{w.name}</p>
                  <p className="text-sm text-muted">{w.employeeCode}</p>
                </div>
                {draft ? (
                  <span className="text-sm font-semibold text-warn">Choose field and job</span>
                ) : r ? (
                  <StatusBadge status={r.status} compact />
                ) : (
                  <span className="text-sm text-muted">Not marked</span>
                )}
              </div>
              {r?.message && r.status !== "accepted" && <p className="mt-1 text-sm text-bad">{r.message}</p>}
              <fieldset className="mt-2 grid grid-cols-3 gap-2">
                <legend className="sr-only">Attendance for {w.name}</legend>
                {[
                  { label: "Full day", on: present && d.dayFraction !== "HALF", act: () => mark(w.id, { statusCode: "PRESENT", dayFraction: "FULL" }) },
                  { label: "Half day", on: present && d.dayFraction === "HALF", act: () => mark(w.id, { statusCode: "PRESENT", dayFraction: "HALF" }) },
                  { label: "Absent", on: d.statusCode === "ABSENT", act: () => mark(w.id, { statusCode: "ABSENT" }) },
                ].map((b) => (
                  <Button key={b.label} variant={b.on ? "primary" : "secondary"} aria-pressed={b.on} disabled={!canCapture} onClick={b.act}>
                    {b.label}
                  </Button>
                ))}
              </fieldset>
              {present && (
                <div className="mt-2 grid grid-cols-2 gap-2">
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
                </div>
              )}
            </li>
          );
        })}
        {shown.length === 0 && <Notice>No workers match. Workers come from the master list (Manage → Import).</Notice>}
      </ul>
    </div>
  );
}
