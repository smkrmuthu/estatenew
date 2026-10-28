import { formatScaled, parseReading, ReadingError } from "@cemms/domain";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useApp } from "../app-context";
import { Button, Card, Field, Input, Notice, Select, StatusBadge } from "../components/ui";
import { api } from "../lib/api";
import { db, type LocalRecord } from "../lib/db";
import { useLive } from "../lib/hooks";
import { queueChange } from "../lib/outbox";

interface ServerReading {
  id: string;
  kindId: string;
  readingAt: string;
  valueScaled: number | null;
  valueText: string | null;
  status: "ACTIVE" | "VOID";
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
    const out = new Map<string, { id: string; kind: string; at: string; value: string; status: LocalRecord["status"]; message?: string }>();
    for (const r of server.data ?? []) {
      if (r.status === "VOID") continue;
      const k = kinds.find((x) => x.id === r.kindId);
      out.set(r.id, { id: r.id, kind: k?.label ?? "?", at: r.readingAt, value: `${r.valueText ?? formatScaled(r.valueScaled ?? 0, k?.decimals ?? 0)} ${k?.unit ?? ""}`, status: "accepted" });
    }
    for (const r of local) {
      if (out.has(r.entityId) && r.status === "accepted") continue;
      const d = r.data as { kindId: string; readingAt: string; value: string };
      const k = kinds.find((x) => x.id === d.kindId);
      out.set(r.entityId, { id: r.entityId, kind: k?.label ?? "?", at: d.readingAt, value: `${d.value} ${k?.unit ?? ""}`, status: r.status, message: r.message });
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
  return (
    <div className="flex flex-col gap-4">
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
    </div>
  );
}
