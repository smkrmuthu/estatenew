import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button, Drawer, Field, Input, Notice } from "../components/ui";
import { ApiError, api } from "../lib/api";

/**
 * A manager's correction of one saved reading. The old value stays in the history with the reason and the time;
 * the server checks the new value against the kind's rules.
 */
export function CorrectReading({
  id,
  version,
  title,
  unit,
  numeric,
  value: start,
  remarks: startRemarks,
  onClose,
}: {
  id: string;
  version: number;
  title: string;
  unit: string | null;
  numeric: boolean;
  value: string;
  remarks: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [value, setValue] = useState(start);
  const [remarks, setRemarks] = useState(startRemarks);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!value.trim()) return setError("Enter the value.");
    if (reason.trim().length < 3) return setError("Give a reason for the correction.");
    setBusy(true);
    setError("");
    try {
      await api(`/daily-log-entries/${id}/corrections`, { body: { value: value.trim(), remarks: remarks.trim() || null, reason: reason.trim(), baseVersion: version } });
      await Promise.all([qc.invalidateQueries({ queryKey: ["dailylog-range"] }), qc.invalidateQueries({ queryKey: ["dashboard"] }), qc.invalidateQueries({ queryKey: ["summary"] })]);
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer title={title} subtitle="Correct reading" onClose={onClose}>
      <p className="text-sm text-muted">The old reading stays in the history with your reason and the time of the correction.</p>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label={unit ? `Data (${unit})` : "Data"} htmlFor="cr-value">
          <Input id="cr-value" inputMode={numeric ? "decimal" : "text"} value={value} onChange={(e) => setValue(e.target.value)} />
        </Field>
        <Field label="Remarks (optional)" htmlFor="cr-remarks">
          <Input id="cr-remarks" maxLength={500} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </Field>
        <Field label="Reason for the correction" htmlFor="cr-reason" hint="For example: read the wrong gauge">
          <Input id="cr-reason" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
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
