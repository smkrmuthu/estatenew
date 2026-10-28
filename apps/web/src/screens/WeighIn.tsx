import { computeWeighIn, formatKg, parseKg, WeightError } from "@cemms/domain";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useApp } from "../app-context";
import { Button, Card, Field, Input, Notice, Select, StatusBadge } from "../components/ui";
import { api } from "../lib/api";
import { db, type LocalRecord } from "../lib/db";
import { useLive } from "../lib/hooks";
import { queueChange } from "../lib/outbox";

interface ServerEntry {
  id: string;
  workerId: string;
  fieldId: string;
  crop: string;
  netG: number;
  grossG: number;
  bags: number;
  status: "ACTIVE" | "VOID";
  version: number;
}

const KG_TEXT = /^\d{0,7}(\.\d{0,3})?$/;

export function WeighIn() {
  const app = useApp();
  const { ref, estateId, date, session } = app;
  const tenantId = session.user.tenantId;
  const [workerId, setWorkerId] = useState("");
  const [workerSearch, setWorkerSearch] = useState("");
  const [fieldId, setFieldId] = useState("");
  const [crop, setCrop] = useState("COFFEE");
  const [varietyId, setVarietyId] = useState("");
  const [gross, setGross] = useState("");
  const [bags, setBags] = useState(1);
  const [tare, setTare] = useState("");
  const [remarks, setRemarks] = useState("");
  const [saved, setSaved] = useState<string | null>(null);

  const workers = useMemo(() => (ref?.workers ?? []).filter((w) => w.estateId === estateId), [ref, estateId]);
  const fields = useMemo(() => (ref?.fields ?? []).filter((f) => f.estateId === estateId), [ref, estateId]);
  const field = fields.find((f) => f.id === fieldId);
  const crops = field?.crops ?? ["COFFEE"];
  const varieties = (ref?.varieties ?? []).filter((v) => v.crop === crop && (!field?.varietyIds.length || field.varietyIds.includes(v.id)));
  const matches = workers.filter((w) => workerSearch && `${w.name} ${w.employeeCode}`.toLowerCase().includes(workerSearch.toLowerCase())).slice(0, 8);
  const worker = workers.find((w) => w.id === workerId);

  const preview = (() => {
    if (!gross) return { net: null as string | null, error: null as string | null };
    try {
      const w = computeWeighIn({ grossGrams: parseKg(gross), bags, tareGrams: tare ? parseKg(tare) : 0 }, "MANUAL");
      return { net: formatKg(w.netGrams), error: null };
    } catch (e) {
      return { net: null, error: e instanceof WeightError ? e.message : "Check the weight" };
    }
  })();

  const server = useQuery({
    queryKey: ["muster", estateId, date],
    queryFn: () => api<ServerEntry[]>(`/estates/${estateId}/muster/${date}`),
    enabled: app.online && !!estateId && app.can("muster.read"),
  });
  const local = useLive(
    () => db.records.where("[tenantId+entityType+estateId+businessDate]").equals([tenantId, "muster_entry", estateId, date]).toArray(),
    [tenantId, estateId, date],
    [] as LocalRecord[],
  );
  const rows = useMemo(() => {
    const out = new Map<string, { id: string; workerId: string; fieldId: string; crop: string; netKg: string; status: LocalRecord["status"]; voided: boolean; message?: string; version: number }>();
    for (const e of server.data ?? [])
      out.set(e.id, { id: e.id, workerId: e.workerId, fieldId: e.fieldId, crop: e.crop, netKg: formatKg(e.netG), status: "accepted", voided: e.status === "VOID", version: e.version });
    for (const r of local) {
      const d = r.data as { workerId: string; fieldId: string; crop: string; grossKg: string; tareKg?: string | null; status?: string };
      if (out.has(r.entityId) && r.status === "accepted") continue;
      let netKg = "?";
      try {
        netKg = formatKg(parseKg(d.grossKg) - (d.tareKg ? parseKg(d.tareKg) : 0));
      } catch {}
      out.set(r.entityId, { id: r.entityId, workerId: d.workerId, fieldId: d.fieldId, crop: d.crop, netKg, status: r.status, voided: d.status === "VOID", message: r.message, version: r.nextBase });
    }
    return [...out.values()].reverse();
  }, [server.data, local]);

  async function save() {
    if (!worker || !field || !preview.net) return;
    const payload = {
      businessDate: date,
      workerId: worker.id,
      fieldId: field.id,
      subdivision: null,
      crop,
      varietyId: varietyId || null,
      grossKg: gross,
      bags,
      tareKg: tare || null,
      remarks: remarks.trim() || null,
    };
    await queueChange({
      tenantId,
      userId: session.user.id,
      deviceId: app.deviceId,
      entityType: "muster_entry",
      op: "create",
      estateId,
      businessDate: date,
      payload,
      label: `Weigh-in: ${worker.name} ${preview.net} kg ${crop === "PEPPER" ? "pepper" : "coffee"}`,
    });
    setSaved(`${worker.name}: ${preview.net} kg saved on this phone.`);
    setWorkerId("");
    setWorkerSearch("");
    setGross("");
    setTare("");
    setRemarks("");
    setBags(1);
    void app.sync();
  }

  async function cancelEntry(id: string, version: number, name: string) {
    const reason = window.prompt(`Why cancel this weigh-in for ${name}?`);
    if (!reason || reason.trim().length < 3) return;
    // Entries made on another phone have no local copy yet: base the change on the server version.
    const key = `muster_entry:${id}`;
    if (!(await db.records.get(key))) {
      await db.records.put({
        key,
        tenantId,
        entityType: "muster_entry",
        entityId: id,
        estateId,
        businessDate: date,
        data: {},
        status: "accepted",
        serverVersion: version,
        nextBase: version,
        lastMutationId: "",
        updatedAt: new Date().toISOString(),
      });
    }
    await queueChange({
      tenantId,
      userId: session.user.id,
      deviceId: app.deviceId,
      entityType: "muster_entry",
      op: "void",
      estateId,
      businessDate: date,
      entityId: id,
      payload: { reason: reason.trim() },
      label: `Cancel weigh-in: ${name}`,
    });
    void app.sync();
  }

  if (!ref) return <Notice>Connect to the internet once to download the worker and field lists.</Notice>;
  const canCapture = app.can("muster.capture");

  return (
    <div className="flex flex-col gap-4">
      <Card title={`Weigh-in · ${date}`}>
        {!canCapture && <Notice tone="warn">You can view weigh-ins but not record them.</Notice>}
        {saved && <Notice tone="ok">{saved}</Notice>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Worker" htmlFor="worker" hint={worker ? `${worker.name} (${worker.employeeCode})` : "Type a name or code"}>
            <Input
              id="worker"
              type="search"
              value={worker ? worker.name : workerSearch}
              onChange={(e) => {
                setWorkerId("");
                setWorkerSearch(e.target.value);
              }}
              autoComplete="off"
            />
            {!worker && matches.length > 0 && (
              <ul className="mt-1 rounded-xl border border-line bg-surface" aria-label="Matching workers">
                {matches.map((w) => (
                  <li key={w.id}>
                    <button type="button" className="min-h-11 w-full px-3 text-left hover:bg-bg" onClick={() => setWorkerId(w.id)}>
                      {w.name} <span className="text-muted">· {w.employeeCode}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Field>
          <Field label="Field" htmlFor="field">
            <Select
              id="field"
              value={fieldId}
              onChange={(e) => {
                setFieldId(e.target.value);
                const f = fields.find((x) => x.id === e.target.value);
                if (f && !f.crops.includes(crop)) setCrop(f.crops[0] ?? "COFFEE");
                setVarietyId("");
              }}
            >
              <option value="">Choose…</option>
              {fields.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </Select>
          </Field>
          <fieldset className="flex flex-col gap-1">
            <legend className="text-sm font-semibold">Crop</legend>
            <div className="grid grid-cols-2 gap-2">
              {["COFFEE", "PEPPER"].map((c) => (
                <Button
                  key={c}
                  variant={crop === c ? "primary" : "secondary"}
                  aria-pressed={crop === c}
                  disabled={!crops.includes(c)}
                  onClick={() => {
                    setCrop(c);
                    setVarietyId("");
                  }}
                >
                  {c === "COFFEE" ? "Coffee" : "Pepper"}
                </Button>
              ))}
            </div>
          </fieldset>
          <Field label="Variety (optional)" htmlFor="variety">
            <Select id="variety" value={varietyId} onChange={(e) => setVarietyId(e.target.value)}>
              <option value="">Not recorded</option>
              {varieties.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Gross weight (kg)" htmlFor="gross" error={preview.error ?? undefined}>
            <Input id="gross" inputMode="decimal" className="text-2xl font-bold" placeholder="0.0" value={gross} onChange={(e) => KG_TEXT.test(e.target.value) && setGross(e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Bags" htmlFor="bags">
              <div className="flex items-center gap-2">
                <Button variant="secondary" aria-label="One bag less" onClick={() => setBags(Math.max(0, bags - 1))}>
                  −
                </Button>
                <Input id="bags" inputMode="numeric" className="text-center" value={bags} onChange={(e) => setBags(Math.min(100, Number(e.target.value.replace(/\D/g, "")) || 0))} />
                <Button variant="secondary" aria-label="One bag more" onClick={() => setBags(Math.min(100, bags + 1))}>
                  +
                </Button>
              </div>
            </Field>
            <Field label="Tare (kg)" htmlFor="tare" hint="Bag weight to take off, if any">
              <Input id="tare" inputMode="decimal" placeholder="0" value={tare} onChange={(e) => KG_TEXT.test(e.target.value) && setTare(e.target.value)} />
            </Field>
          </div>
          <Field label="Remark (optional)" htmlFor="remarks">
            <Input id="remarks" maxLength={500} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </Field>
        </div>
        <div className="mt-4 flex items-center justify-between gap-3">
          <p className="text-lg">
            Net: <strong className="text-2xl">{preview.net ?? "–"}</strong> kg
          </p>
          <Button size="lg" disabled={!canCapture || !worker || !field || !preview.net} onClick={save}>
            Save weigh-in
          </Button>
        </div>
      </Card>

      <Card title="Today's weigh-ins">
        <ul className="divide-y divide-line">
          {rows.map((r) => {
            const w = workers.find((x) => x.id === r.workerId);
            return (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div>
                  <p className={r.voided ? "font-semibold line-through" : "font-semibold"}>
                    {w?.name ?? "Worker"} · {r.netKg} kg {r.crop === "PEPPER" ? "pepper" : "coffee"}
                  </p>
                  <p className="text-sm text-muted">
                    {fields.find((f) => f.id === r.fieldId)?.name}
                    {r.voided ? " · cancelled" : ""}
                  </p>
                  {r.message && r.status !== "accepted" && <p className="text-sm text-bad">{r.message}</p>}
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={r.status} compact />
                  {!r.voided && r.status === "accepted" && canCapture && (
                    <Button size="sm" variant="ghost" onClick={() => cancelEntry(r.id, r.version, w?.name ?? "worker")}>
                      Cancel
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
          {rows.length === 0 && <li className="py-2 text-muted">No weigh-ins yet.</li>}
        </ul>
      </Card>
    </div>
  );
}
