import { computeWeighIn, formatKg, parseKg, WeightError } from "@cemms/domain";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useApp } from "../app-context";
import { Button, Card, Field, FilterBar, FilterSearch, FilterSelect, Input, KpiStrip, Notice, Select, StatusBadge } from "../components/ui";
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
  subdivision?: string | null;
  varietyId?: string | null;
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
  const [fieldFromAttendance, setFieldFromAttendance] = useState(false);

  const workers = useMemo(() => (ref?.workers ?? []).filter((w) => (w.estateIds ?? [w.estateId]).includes(estateId)), [ref, estateId]);
  const fields = useMemo(() => (ref?.fields ?? []).filter((f) => f.estateId === estateId), [ref, estateId]);
  const field = fields.find((f) => f.id === fieldId);
  const crops = field?.crops ?? ["COFFEE"];
  const varieties = (ref?.varieties ?? []).filter((v) => v.crop === crop && (!field?.varietyIds.length || field.varietyIds.includes(v.id)));
  // The field decides the variety: its bearing subdivisions carry one each (A, B, ...). One variety is filled in; several must be picked.
  const choices = useMemo(() => {
    const byVariety = new Map<string, { id: string; name: string; letters: string[] }>();
    for (const s of field?.subdivisions ?? []) {
      const v = (ref?.varieties ?? []).find((x) => x.id === s.varietyId);
      if (s.landUse !== "BEARING" || !v || v.crop !== crop) continue;
      const cur = byVariety.get(v.id) ?? { id: v.id, name: v.name, letters: [] };
      cur.letters.push(s.label);
      byVariety.set(v.id, cur);
    }
    return [...byVariety.values()];
  }, [field, ref, crop]);
  const needsVariety = choices.length > 1;
  const choiceLabel = (c: { name: string; letters: string[] }) => `${c.name} (${c.letters.join(", ")})`;
  useEffect(() => {
    if (choices.length === 1) setVarietyId(choices[0]?.id ?? "");
    else if (choices.length > 1) setVarietyId((cur) => (choices.some((c) => c.id === cur) ? cur : ""));
  }, [choices]);
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
  const attendance = useQuery({
    queryKey: ["sheet", estateId, date],
    queryFn: () => api<{ records: { workerId: string; fieldId: string | null; statusCode?: string; shift?: string }[] }>(`/estates/${estateId}/attendance/${date}`),
    enabled: app.online && !!estateId && app.can("attendance.read"),
  });
  const localAttendance = useLive(
    () => db.records.where("[tenantId+entityType+estateId+businessDate]").equals([tenantId, "attendance_record", estateId, date]).toArray(),
    [tenantId, estateId, date],
    [] as LocalRecord[],
  );
  /** The field a worker was marked present on this morning: this phone's mark first, then the server's. */
  const attendanceField = (id: string): string | null => {
    const l = localAttendance.find((r) => (r.data as { workerId?: string; shift?: string }).workerId === id && ((r.data as { shift?: string }).shift ?? "DAY") === "DAY")?.data as
      | { statusCode?: string; fieldId?: string | null }
      | undefined;
    if (l?.statusCode === "PRESENT" && l.fieldId) return l.fieldId;
    return attendance.data?.records.find((r) => r.workerId === id && (r.shift ?? "DAY") === "DAY" && r.statusCode === "PRESENT")?.fieldId ?? null;
  };
  const local = useLive(
    () => db.records.where("[tenantId+entityType+estateId+businessDate]").equals([tenantId, "muster_entry", estateId, date]).toArray(),
    [tenantId, estateId, date],
    [] as LocalRecord[],
  );
  const totals = useMemo(() => {
    const active = (server.data ?? []).filter((e) => e.status === "ACTIVE");
    const g = active.reduce((sum, e) => sum + e.netG, 0);
    const weighed = new Set(active.map((e) => e.workerId)).size;
    return { kg: formatKg(g), entries: active.length, workers: weighed, perWorker: weighed ? formatKg(Math.round(g / weighed)) : "0.000" };
  }, [server.data]);
  // Accepted weigh-ins grouped by field, subdivision and variety. The letter is filled only when one subdivision carries the variety.
  const bySubdivision = useMemo(() => {
    const m = new Map<string, { field: string; subdivision: string; variety: string; workers: Set<string>; netG: number }>();
    for (const e of (server.data ?? []).filter((x) => x.status === "ACTIVE")) {
      const key = `${e.fieldId}|${e.subdivision ?? ""}|${e.varietyId ?? ""}`;
      const cur = m.get(key) ?? {
        field: fields.find((f) => f.id === e.fieldId)?.name ?? "?",
        subdivision: e.subdivision ?? "",
        variety: (ref?.varieties ?? []).find((v) => v.id === e.varietyId)?.name ?? "",
        workers: new Set<string>(),
        netG: 0,
      };
      cur.workers.add(e.workerId);
      cur.netG += e.netG;
      m.set(key, cur);
    }
    return [...m.values()].sort((a, b) => b.netG - a.netG);
  }, [server.data, fields, ref]);
  // Filters over the day's list (they only change what is listed).
  const [lq, setLq] = useState("");
  const [lField, setLField] = useState("");
  const [lCrop, setLCrop] = useState("");
  const [lState, setLState] = useState("");
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

  const listed = rows.filter((r) => {
    const w = workers.find((x) => x.id === r.workerId);
    if (lq && !`${w?.name ?? ""} ${w?.employeeCode ?? ""}`.toLowerCase().includes(lq.toLowerCase())) return false;
    if (lField && r.fieldId !== lField) return false;
    if (lCrop && r.crop !== lCrop) return false;
    if (lState === "CANCELLED") return r.voided;
    if (lState === "ACCEPTED") return r.status === "accepted" && !r.voided;
    if (lState === "WAITING") return r.status === "waiting";
    if (lState === "PROBLEM") return r.status !== "accepted" && r.status !== "waiting";
    return true;
  });
  const listFiltersOn = !!(lq || lField || lCrop || lState);

  async function save() {
    if (!worker || !field || !preview.net) return;
    const payload = {
      businessDate: date,
      workerId: worker.id,
      fieldId: field.id,
      // The subdivision letter is recorded only when exactly one bearing subdivision carries the chosen variety.
      subdivision: (() => {
        const c = choices.find((x) => x.id === varietyId);
        return c && c.letters.length === 1 ? (c.letters[0] ?? null) : null;
      })(),
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
      <div>
        <h1>Plucking</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">Each worker's cherry (coffee) or pepper is weighed at the evening muster. Weights count here once the server has accepted them.</p>
      </div>

      <KpiStrip
        items={[
          { label: "Net weight", value: `${totals.kg} kg`, note: "Accepted by the server" },
          { label: "Weigh-ins", value: totals.entries },
          {
            label: "Workers weighed",
            value: (
              <>
                {totals.workers} <span className="text-sm font-normal text-muted">of {workers.length}</span>
              </>
            ),
          },
          { label: "Per worker", value: `${totals.perWorker} kg`, note: "Average of workers weighed" },
        ]}
      />

      <Card title="Record weigh-ins" actions={<span className="text-sm text-muted">{date}</span>}>
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
                    <button
                      type="button"
                      className="min-h-11 w-full px-3 text-left hover:bg-bg"
                      onClick={() => {
                        setWorkerId(w.id);
                        const f = attendanceField(w.id);
                        if (f) {
                          setFieldId(f);
                          setFieldFromAttendance(true);
                          const ff = fields.find((x) => x.id === f);
                          if (ff && !ff.crops.includes(crop)) setCrop(ff.crops[0] ?? "COFFEE");
                          setVarietyId("");
                        }
                      }}
                    >
                      {w.name} <span className="text-muted">· {w.employeeCode}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Field>
          <Field label="Field" htmlFor="field" hint={fieldFromAttendance && fieldId && fieldId === (worker ? attendanceField(worker.id) : null) ? "Field from this morning's attendance" : undefined}>
            <Select
              id="field"
              value={fieldId}
              onChange={(e) => {
                setFieldId(e.target.value);
                setFieldFromAttendance(false);
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
          {choices.length === 1 ? (
            <Field label="Variety" htmlFor="variety" hint="Set by the field">
              <p id="variety" className="flex min-h-12 items-center font-medium">
                {choiceLabel(choices[0] as (typeof choices)[number])}
              </p>
            </Field>
          ) : needsVariety ? (
            <Field label="Variety" htmlFor="variety" hint="This field has more than one variety. Pick which one this was.">
              <Select id="variety" value={varietyId} onChange={(e) => setVarietyId(e.target.value)}>
                <option value="">Pick the variety…</option>
                {choices.map((c) => (
                  <option key={c.id} value={c.id}>
                    {choiceLabel(c)}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
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
          )}
          <Field label="Gross weight (kg)" htmlFor="gross" error={preview.error ?? undefined}>
            <Input
              id="gross"
              inputMode="decimal"
              className="font-mono text-2xl font-semibold"
              placeholder="0.0"
              value={gross}
              onChange={(e) => KG_TEXT.test(e.target.value) && setGross(e.target.value)}
            />
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
          <Button size="lg" disabled={!canCapture || !worker || !field || !preview.net || (needsVariety && !varietyId)} onClick={save}>
            Save weigh-in
          </Button>
        </div>
      </Card>

      <Card title="By subdivision" actions={<span className="text-sm text-muted">{date}</span>}>
        {bySubdivision.length === 0 ? (
          <p className="text-muted">No weigh-ins yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[26rem] text-sm">
              <thead className="border-b border-line">
                <tr>
                  {["Field", "Subdivision", "Variety"].map((t) => (
                    <th key={t} className="px-3 py-2 text-left text-[0.8rem] font-medium text-muted">
                      {t}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-right text-[0.8rem] font-medium text-muted">Workers</th>
                  <th className="px-3 py-2 text-right text-[0.8rem] font-medium text-muted">Net kg</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {bySubdivision.map((r) => (
                  <tr key={`${r.field}|${r.subdivision}|${r.variety}`}>
                    <td className="px-3 py-2">{r.field}</td>
                    <td className="px-3 py-2">{r.subdivision || <span className="text-muted">Not recorded</span>}</td>
                    <td className="px-3 py-2">{r.variety || <span className="text-muted">Not recorded</span>}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.workers.size}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatKg(r.netG)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-sm text-muted">
          The subdivision is filled in only when the field has one bearing subdivision with the chosen variety. Which part of a field a weighing came from is still to be confirmed with the owner.
        </p>
      </Card>

      <Card title="Today's weigh-ins">
        <div className="mb-3">
          <FilterBar
            shown={listed.length}
            total={rows.length}
            noun="weigh-ins"
            active={listFiltersOn}
            onClear={() => {
              setLq("");
              setLField("");
              setLCrop("");
              setLState("");
            }}
          >
            <FilterSearch label="Find a worker" value={lq} onChange={setLq} placeholder="Name or code" />
            <FilterSelect label="Field" value={lField} onChange={setLField} options={[{ value: "", label: "All fields" }, ...fields.map((f) => ({ value: f.id, label: f.name }))]} />
            <FilterSelect
              label="Crop"
              value={lCrop}
              onChange={setLCrop}
              options={[
                { value: "", label: "Coffee and pepper" },
                { value: "COFFEE", label: "Coffee" },
                { value: "PEPPER", label: "Pepper" },
              ]}
            />
            <FilterSelect
              label="State"
              value={lState}
              onChange={setLState}
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
        <ul className="divide-y divide-line">
          {listed.map((r) => {
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
          {rows.length > 0 && listed.length === 0 && <li className="py-2 text-muted">No weigh-ins match these filters.</li>}
        </ul>
      </Card>
    </div>
  );
}
