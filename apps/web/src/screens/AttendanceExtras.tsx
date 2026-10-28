import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useApp } from "../app-context";
import { Button, Chip, Drawer, Field, Input, Notice, Select } from "../components/ui";
import { ApiError, api } from "../lib/api";

interface History {
  worker: { id: string; name: string; employeeCode: string };
  daysWorked: number;
  records: { businessDate: string; statusCode: string; dayFraction: "FULL" | "HALF" | null; field: string | null; job: string | null; remarks: string | null }[];
}

const STATUS_TEXT: Record<string, string> = { PRESENT: "Present", ABSENT: "Absent", LEAVE: "Leave", OFF_DAY: "Off day", HOLIDAY: "Holiday" };
const dayText = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });

/** A worker's recent attendance: which days, what status, which field and job. */
export function WorkerHistory({ estateId, workerId, onClose }: { estateId: string; workerId: string; onClose: () => void }) {
  const app = useApp();
  const q = useQuery({
    queryKey: ["worker-history", estateId, workerId],
    queryFn: () => api<History>(`/estates/${estateId}/workers/${workerId}/attendance?days=30`),
    enabled: app.online,
  });
  const h = q.data;
  return (
    <Drawer title={h ? `${h.worker.employeeCode} ${h.worker.name}` : "Worker history"} subtitle="Worker history" onClose={onClose}>
      {!app.online && <Notice tone="warn">History needs signal.</Notice>}
      {q.isLoading && <p>Loading…</p>}
      {q.error && <Notice tone="bad">Could not load the history.</Notice>}
      {h && (
        <>
          <p className="text-sm text-muted">
            The last {h.records.length} days with a mark. {h.daysWorked} days worked in these days (a half day counts as 0.5).
          </p>
          <table className="w-full text-sm">
            <thead className="border-b border-line">
              <tr>
                {["Day", "Status", "Field", "Job"].map((t) => (
                  <th key={t} className="px-2 py-2 text-left text-[0.8rem] font-medium text-muted">
                    {t}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {h.records.map((r) => (
                <tr key={r.businessDate}>
                  <td className="px-2 py-2 tabular-nums">{dayText(r.businessDate)}</td>
                  <td className="px-2 py-2">
                    {STATUS_TEXT[r.statusCode] ?? r.statusCode}
                    {r.dayFraction === "HALF" && <Chip tone="warn">Half day</Chip>}
                  </td>
                  <td className="px-2 py-2">{r.field ?? "–"}</td>
                  <td className="px-2 py-2">{r.job ?? "–"}</td>
                </tr>
              ))}
              {h.records.length === 0 && (
                <tr>
                  <td className="px-2 py-2 text-muted" colSpan={4}>
                    No attendance marked yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </>
      )}
    </Drawer>
  );
}

export interface CorrectChip {
  id: string;
  long: string;
  statusCode: string;
  dayFraction: "FULL" | "HALF" | null;
}

/**
 * A manager's correction of one record on a submitted or approved day. The old entry is kept in the history;
 * the reason is required and goes to the audit trail.
 */
export function CorrectRecord({
  estateId,
  date,
  recordId,
  baseVersion,
  workerName,
  current,
  chips,
  fields,
  jobs,
  onClose,
}: {
  estateId: string;
  date: string;
  recordId: string;
  baseVersion: number;
  workerName: string;
  current: { statusCode?: string; dayFraction?: "FULL" | "HALF" | null; fieldId?: string | null; jobTypeId?: string | null; remarks?: string | null };
  chips: CorrectChip[];
  fields: { id: string; name: string }[];
  jobs: { id: string; name: string }[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const start = chips.find((c) => c.statusCode === current.statusCode && (c.dayFraction ?? null) === (current.dayFraction ?? null)) ?? chips[0];
  const [chip, setChip] = useState(start?.id ?? "");
  const [fieldId, setFieldId] = useState(current.fieldId ?? "");
  const [jobId, setJobId] = useState(current.jobTypeId ?? "");
  const [remarks, setRemarks] = useState(current.remarks ?? "");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const picked = chips.find((c) => c.id === chip);
  const present = picked?.statusCode === "PRESENT";

  async function save() {
    if (!picked) return;
    if (reason.trim().length < 3) return setError("Give a reason for the correction.");
    if (present && (!fieldId || !jobId)) return setError("Choose a field and a job for a present worker.");
    setBusy(true);
    setError("");
    try {
      await api(`/attendance-records/${recordId}/corrections`, {
        body: {
          statusCode: picked.statusCode,
          dayFraction: picked.dayFraction,
          fieldId: present ? fieldId : null,
          jobTypeId: present ? jobId : null,
          remarks: remarks.trim() || null,
          reason: reason.trim(),
          baseVersion,
        },
      });
      await qc.invalidateQueries({ queryKey: ["sheet", estateId, date] });
      await qc.invalidateQueries({ queryKey: ["dashboard"] });
      await qc.invalidateQueries({ queryKey: ["summary"] });
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer title={workerName} subtitle="Correct attendance" onClose={onClose}>
      <p className="text-sm text-muted">This day is already submitted. The old entry stays in the history with your reason and the time of the correction.</p>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label="Status" htmlFor="c-status">
          <Select id="c-status" value={chip} onChange={(e) => setChip(e.target.value)}>
            {chips.map((c) => (
              <option key={c.id} value={c.id}>
                {c.long}
              </option>
            ))}
          </Select>
        </Field>
        {present && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Field" htmlFor="c-field">
              <Select id="c-field" value={fieldId} onChange={(e) => setFieldId(e.target.value)}>
                <option value="">Choose…</option>
                {fields.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Job" htmlFor="c-job">
              <Select id="c-job" value={jobId} onChange={(e) => setJobId(e.target.value)}>
                <option value="">Choose…</option>
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        )}
        <Field label="Remark (optional)" htmlFor="c-remark">
          <Input id="c-remark" maxLength={500} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </Field>
        <Field label="Reason for the correction" htmlFor="c-reason" hint="For example: marked absent by mistake">
          <Input id="c-reason" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        {error && <Notice tone="bad">{error}</Notice>}
        <div className="flex gap-2">
          <Button type="submit" disabled={busy}>
            Save correction
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Drawer>
  );
}
