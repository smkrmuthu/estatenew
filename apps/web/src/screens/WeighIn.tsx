import { computeWeighIn, formatKg, parseKg, WeightError } from "@cemms/domain";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../app-context";
import { Button, Card, Field, FilterBar, FilterSearch, FilterSelect, Input, KpiStrip, Notice, Select, StatusBadge } from "../components/ui";
import { api } from "../lib/api";
import { useCrops } from "../lib/crops";
import { db, type LocalRecord } from "../lib/db";
import { useLive } from "../lib/hooks";
import { normalizeKg } from "../lib/kg";
import { queueChange } from "../lib/outbox";
import { useUnsaved } from "../lib/unsaved";
import { CorrectWeighIn } from "./WeighInExtras";

interface ServerEntry {
  id: string;
  workerId: string;
  fieldId: string;
  crop: string;
  netG: number;
  subdivision?: string | null;
  varietyId?: string | null;
  grossG: number;
  tareG?: number;
  bags: number;
  remarks?: string | null;
  status: "ACTIVE" | "VOID";
  version: number;
}

interface MusterDay {
  date: string;
  entries: number;
  workers: number;
  coffeeNetKg: string;
  pepperNetKg: string;
}

const KG_TEXT = /^\d{0,7}(\.\d{0,3})?$/;

export function WeighIn() {
  const app = useApp();
  const { ref, estateId, date, session } = app;
  const tenantId = session.user.tenantId;
  const [workerId, setWorkerId] = useState("");
  const [fieldId, setFieldId] = useState("");
  const [crop, setCrop] = useState("COFFEE");
  const { enabled: enabledCrops, pepper } = useCrops();
  const [varietyId, setVarietyId] = useState("");
  const [gross, setGross] = useState("");
  const [bags, setBags] = useState(1);
  // Supervisors always use the estate's tare; managers and owners may change it for a weigh-in.
  const defaultTareG = ref?.estates.find((e) => e.id === estateId)?.defaultTareG ?? 0;
  const estateTare = defaultTareG ? formatKg(defaultTareG) : "0";
  const canSetTare = app.can("muster.correct", estateId);
  const [tareEntered, setTare] = useState<string | null>(null);
  const tare = canSetTare ? (tareEntered ?? estateTare) : estateTare;
  const [remarks, setRemarks] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  useUnsaved(!!(gross || remarks));
  const [fieldFromAttendance, setFieldFromAttendance] = useState(false);
  const [correcting, setCorrecting] = useState<string | null>(null);

  const workers = useMemo(() => (ref?.workers ?? []).filter((w) => (w.estateIds ?? [w.estateId]).includes(estateId)), [ref, estateId]);
  const fields = useMemo(() => (ref?.fields ?? []).filter((f) => f.estateId === estateId), [ref, estateId]);
  const field = fields.find((f) => f.id === fieldId);
  const crops = field?.crops ?? ["COFFEE"];
  // Pepper is hidden until it is switched on in Manage.
  const firstCrop = (list: string[]) => list.find((c) => enabledCrops.includes(c)) ?? "COFFEE";
  useEffect(() => {
    if (!pepper && crop !== "COFFEE") setCrop("COFFEE");
  }, [pepper, crop]);
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
  const varietyRequired = ref?.rules?.varietyRequired !== false;
  const choiceLabel = (c: { name: string; letters: string[] }) => `${c.name} (${c.letters.join(", ")})`;
  useEffect(() => {
    if (choices.length === 1) setVarietyId(choices[0]?.id ?? "");
    else if (choices.length > 1) setVarietyId((cur) => (choices.some((c) => c.id === cur) ? cur : ""));
  }, [choices]);
  const worker = workers.find((w) => w.id === workerId);

  const preview = (() => {
    const none = { net: null as string | null, error: null as string | null, tareError: null as string | null };
    if (!gross) return none;
    const why = (e: unknown) => (e instanceof WeightError ? e.message : "Check the weight");
    let tareGrams: number;
    try {
      tareGrams = parseKg(normalizeKg(tare || estateTare));
    } catch (e) {
      return { ...none, tareError: why(e) };
    }
    try {
      const w = computeWeighIn({ grossGrams: parseKg(normalizeKg(gross)), bags, tareGrams }, "MANUAL");
      return { ...none, net: formatKg(w.netGrams) };
    } catch (e) {
      return { ...none, error: why(e) };
    }
  })();

  const server = useQuery({
    queryKey: ["muster", estateId, date],
    queryFn: () => api<ServerEntry[]>(`/estates/${estateId}/muster/${date}`),
    enabled: app.online && !!estateId && app.can("muster.read"),
  });
  const attendance = useQuery({
    queryKey: ["sheet", estateId, date],
    queryFn: () => api<{ records: { workerId: string; fieldId: string | null; jobTypeId?: string | null; statusCode?: string; shift?: string }[] }>(`/estates/${estateId}/attendance/${date}`),
    enabled: app.online && !!estateId && app.can("attendance.read"),
  });
  const localAttendance = useLive(
    () => db.records.where("[tenantId+entityType+estateId+businessDate]").equals([tenantId, "attendance_record", estateId, date]).toArray(),
    [tenantId, estateId, date],
    [] as LocalRecord[],
  );
  /** Who was marked present in the day register this morning, with the field and job: this phone's marks first, then the server's. */
  const dayMarks = useMemo(() => {
    const m = new Map<string, { fieldId: string | null; jobTypeId: string | null }>();
    for (const r of attendance.data?.records ?? []) if ((r.shift ?? "DAY") === "DAY" && r.statusCode === "PRESENT") m.set(r.workerId, { fieldId: r.fieldId, jobTypeId: r.jobTypeId ?? null });
    for (const r of localAttendance) {
      const d = r.data as { workerId?: string; shift?: string; statusCode?: string; fieldId?: string | null; jobTypeId?: string | null };
      if (!d.workerId || (d.shift ?? "DAY") !== "DAY") continue;
      if (d.statusCode === "PRESENT") m.set(d.workerId, { fieldId: d.fieldId ?? null, jobTypeId: d.jobTypeId ?? null });
      else m.delete(d.workerId);
    }
    return m;
  }, [attendance.data, localAttendance]);
  const attendanceField = (id: string): string | null => dayMarks.get(id)?.fieldId ?? null;
  const pluckingJobs = useMemo(() => new Set((ref?.jobTypes ?? []).filter((j) => j.countsAsPlucking).map((j) => j.id)), [ref]);
  /** Workers marked present for a plucking job today: the people expected at the evening weigh-in. */
  const pluckers = useMemo(
    () =>
      workers.filter((w) => {
        const j = dayMarks.get(w.id)?.jobTypeId;
        return !!j && pluckingJobs.has(j);
      }),
    [workers, dayMarks, pluckingJobs],
  );
  const otherWorkers = useMemo(() => workers.filter((w) => !pluckers.some((p) => p.id === w.id)), [workers, pluckers]);
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
    const out = new Map<
      string,
      { id: string; workerId: string; fieldId: string; crop: string; grossKg: string; tareKg: string; netKg: string; status: LocalRecord["status"]; voided: boolean; message?: string; version: number }
    >();
    for (const e of server.data ?? [])
      out.set(e.id, {
        id: e.id,
        workerId: e.workerId,
        fieldId: e.fieldId,
        crop: e.crop,
        grossKg: formatKg(e.grossG),
        tareKg: formatKg(e.tareG ?? 0),
        netKg: formatKg(e.netG),
        status: "accepted",
        voided: e.status === "VOID",
        version: e.version,
      });
    for (const r of local) {
      const d = r.data as { workerId: string; fieldId: string; crop: string; grossKg: string; tareKg?: string | null; status?: string };
      if (out.has(r.entityId) && r.status === "accepted") continue;
      let netKg = "?";
      let grossKg = "?";
      let tareKg = "?";
      try {
        grossKg = formatKg(parseKg(d.grossKg));
        tareKg = formatKg(d.tareKg ? parseKg(d.tareKg) : 0);
        netKg = formatKg(parseKg(d.grossKg) - (d.tareKg ? parseKg(d.tareKg) : 0));
      } catch {}
      out.set(r.entityId, {
        id: r.entityId,
        workerId: d.workerId,
        fieldId: d.fieldId,
        crop: d.crop,
        grossKg,
        tareKg,
        netKg,
        status: r.status,
        voided: d.status === "VOID",
        message: r.message,
        version: r.nextBase,
      });
    }
    return [...out.values()].reverse();
  }, [server.data, local]);

  const weighedIds = useMemo(() => new Set(rows.filter((r) => !r.voided).map((r) => r.workerId)), [rows]);
  const weighedPluckers = pluckers.filter((w) => weighedIds.has(w.id)).length;
  const days = useQuery({
    queryKey: ["muster-days", estateId, date],
    queryFn: () => api<{ days: MusterDay[] }>(`/estates/${estateId}/muster-days/${date}`),
    enabled: app.online && !!estateId && app.can("muster.read"),
  });

  /** Choose a worker and bring in the field and variety they were marked on this morning. */
  function pickWorker(id: string) {
    setWorkerId(id);
    const f = attendanceField(id);
    if (f) {
      setFieldId(f);
      setFieldFromAttendance(true);
      const ff = fields.find((x) => x.id === f);
      if (ff && !ff.crops.includes(crop)) setCrop(firstCrop(ff.crops));
      setVarietyId("");
    } else {
      setFieldFromAttendance(false);
    }
  }
  // A new estate or day starts with nobody chosen; the first plucker not yet weighed is filled in once the day's attendance is known.
  const pickedFor = useRef("");
  useEffect(() => {
    pickedFor.current = "";
    setWorkerId("");
    setFieldId("");
    setFieldFromAttendance(false);
  }, [estateId, date]);
  useEffect(() => {
    const key = `${estateId}|${date}`;
    if (pickedFor.current === key || pluckers.length === 0) return;
    pickedFor.current = key;
    const first = pluckers.find((w) => !weighedIds.has(w.id)) ?? pluckers[0];
    if (first) pickWorker(first.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estateId, date, pluckers, weighedIds]);

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
      grossKg: normalizeKg(gross),
      bags,
      tareKg: normalizeKg(tare || estateTare),
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
    // Move on to the next plucker (after this one in the list) who has no weigh-in yet.
    const at = pluckers.findIndex((w) => w.id === worker.id);
    const order = at < 0 ? pluckers : [...pluckers.slice(at + 1), ...pluckers.slice(0, at)];
    const next = order.find((w) => w.id !== worker.id && !weighedIds.has(w.id));
    if (next) pickWorker(next.id);
    else setWorkerId("");
    setGross("");
    setTare(null);
    setRemarks("");
    setBags(1);
    void app.sync();
  }

  async function cancelEntry(id: string, version: number, name: string) {
    const reason = window.prompt(`Why cancel this weigh-in for ${name}?`);
    if (!reason || reason.trim().length < 3) return;
    // Base the cancel on the server's current version: this phone's own copy may be older if the weigh-in was corrected since.
    const key = `muster_entry:${id}`;
    const existing = await db.records.get(key);
    await db.records.put({
      key,
      tenantId,
      entityType: "muster_entry",
      entityId: id,
      estateId,
      businessDate: date,
      data: existing?.data ?? {},
      status: "accepted",
      serverVersion: version,
      nextBase: version,
      lastMutationId: existing?.lastMutationId ?? "",
      updatedAt: new Date().toISOString(),
    });
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
      <div className="lg:flex lg:flex-wrap lg:items-baseline lg:gap-x-4">
        <h1>Plucking</h1>
        <p className="mt-1 lg:mt-0 max-w-3xl text-sm text-muted">The evening muster: every weigh-in by worker, field, subdivision and variety. Weights count here once the server has accepted them.</p>
      </div>

      <KpiStrip
        items={[
          { label: "Net cherry", value: `${totals.kg} kg`, note: "Accepted by the server" },
          { label: "Weigh-ins", value: totals.entries },
          {
            label: "Pluckers weighed",
            value: (
              <>
                {totals.workers} <span className="text-sm font-normal text-muted">of {Math.max(pluckers.length, totals.workers)}</span>
              </>
            ),
            note: pluckers.length ? "Marked present for plucking" : "No one marked for plucking yet",
          },
          { label: "Per plucker", value: `${totals.perWorker} kg`, note: "Average of pluckers weighed" },
        ]}
      />

      <Card title="Record weigh-ins" actions={<span className="text-sm text-muted">{pluckers.length ? `${weighedPluckers} of ${pluckers.length} pluckers weighed` : date}</span>}>
        {!canCapture && <Notice tone="warn">You can view weigh-ins but not record them.</Notice>}
        {saved && <Notice tone="ok">{saved}</Notice>}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 wide:grid-cols-[minmax(12rem,1.5fr)_minmax(9rem,1fr)_minmax(9rem,1fr)_8rem_19rem_auto]">
          <Field
            label="Worker"
            htmlFor="worker"
            hint={
              pluckers.length
                ? "A tick means already weighed today"
                : pluckingJobs.size
                  ? "No one is marked present for plucking yet, so every worker is listed"
                  : "No job is marked as plucking in Masters, so every worker is listed"
            }
          >
            <Select id="worker" value={workerId} onChange={(e) => (e.target.value ? pickWorker(e.target.value) : setWorkerId(""))}>
              <option value="">Choose…</option>
              {pluckers.length > 0 && (
                <optgroup label="Marked present for plucking">
                  {pluckers.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.employeeCode} · {w.name}
                      {weighedIds.has(w.id) ? " ✓" : ""}
                    </option>
                  ))}
                </optgroup>
              )}
              {otherWorkers.length > 0 && (
                <optgroup label={pluckers.length ? "Other workers" : "Workers"}>
                  {otherWorkers.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.employeeCode} · {w.name}
                      {weighedIds.has(w.id) ? " ✓" : ""}
                    </option>
                  ))}
                </optgroup>
              )}
            </Select>
          </Field>
          <Field label="Field" htmlFor="field" hint={fieldFromAttendance && fieldId && fieldId === (worker ? attendanceField(worker.id) : null) ? "Field from this morning's attendance" : undefined}>
            <Select
              id="field"
              value={fieldId}
              onChange={(e) => {
                setFieldId(e.target.value);
                setFieldFromAttendance(false);
                const f = fields.find((x) => x.id === e.target.value);
                if (f && !f.crops.includes(crop)) setCrop(firstCrop(f.crops));
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
          {pepper && (
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
          )}
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
            <Field
              label={varietyRequired ? "Variety" : "Variety (optional)"}
              htmlFor="variety"
              hint={varietyRequired && varieties.length === 0 ? "No variety is listed for this field. Add one in Masters → Varieties." : undefined}
            >
              <Select id="variety" value={varietyId} onChange={(e) => setVarietyId(e.target.value)}>
                <option value="">{varietyRequired ? "Pick the variety…" : "Not recorded"}</option>
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
          <div className="grid grid-cols-2 gap-3 wide:grid-cols-[11rem_1fr]">
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
            <Field
              label="Tare (kg)"
              htmlFor="tare"
              error={preview.tareError ?? undefined}
              hint={canSetTare ? "Taken off this weigh-in. Change it only if this one differs." : "Set by your manager for this estate"}
            >
              <Input id="tare" inputMode="decimal" placeholder="0" value={tare} readOnly={!canSetTare} onChange={(e) => KG_TEXT.test(e.target.value) && setTare(e.target.value)} />
            </Field>
          </div>
          <div className="wide:order-1 wide:col-span-2">
            <Field label="Remark (optional)" htmlFor="remarks">
              <Input id="remarks" maxLength={500} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
            </Field>
          </div>
          <div className="flex items-center justify-between gap-3 sm:col-span-2 wide:col-span-1 wide:mt-[1.6rem] wide:gap-5">
            <p className="text-lg">
              Net: <strong className="text-2xl">{preview.net ?? "–"}</strong> kg
            </p>
            <Button size="lg" disabled={!canCapture || !worker || !field || !preview.net || ((needsVariety || varietyRequired) && !varietyId)} onClick={save}>
              Save and next worker
            </Button>
          </div>
        </div>
        {worker && field && preview.net && (needsVariety || varietyRequired) && !varietyId && <p className="mt-3 text-sm text-bad">Pick the variety before saving.</p>}
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
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

        <Card title="Muster and washing" actions={<span className="text-sm text-muted">Last 10 days</span>}>
          {days.isError ? (
            <p className="text-muted">The recent days could not be loaded. They will appear when the connection is back.</p>
          ) : !days.data ? (
            <p className="text-muted">{app.online ? "Loading…" : "Connect to the internet to see the recent days."}</p>
          ) : days.data.days.length === 0 ? (
            <p className="text-muted">No weigh-ins yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[22rem] text-sm">
                <thead className="border-b border-line">
                  <tr>
                    <th className="px-3 py-2 text-left text-[0.8rem] font-medium text-muted">Day</th>
                    <th className="px-3 py-2 text-right text-[0.8rem] font-medium text-muted">Muster</th>
                    <th className="px-3 py-2 text-right text-[0.8rem] font-medium text-muted">Washed</th>
                    <th className="px-3 py-2 text-left text-[0.8rem] font-medium text-muted">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {days.data.days.map((d) => (
                    <tr key={d.date} className={d.date === date ? "bg-bg" : undefined}>
                      <td className="px-3 py-2">
                        <button type="button" className="min-h-11 text-left font-medium underline-offset-2 hover:underline" onClick={() => app.setDate(d.date)}>
                          {new Date(`${d.date}T12:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                        </button>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                        {d.coffeeNetKg} kg
                        {pepper && d.pepperNetKg !== "0.000" && <span className="block text-xs text-muted">+ {d.pepperNetKg} kg pepper</span>}
                      </td>
                      <td className="px-3 py-2 text-right text-muted">–</td>
                      <td className="px-3 py-2 text-muted">
                        {d.entries} weigh-in{d.entries === 1 ? "" : "s"} · {d.workers} worker{d.workers === 1 ? "" : "s"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-2 text-sm text-muted">Washing is not recorded in the app yet, so the Washed column stays empty. Only weigh-ins the server has accepted are counted.</p>
        </Card>
      </div>

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
            {pepper && (
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
            )}
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
        <ul className="2xl:grid 2xl:grid-cols-2 2xl:gap-x-10">
          {listed.map((r) => {
            const w = workers.find((x) => x.id === r.workerId);
            return (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line py-2">
                <div>
                  <p className={r.voided ? "font-semibold line-through" : "font-semibold"}>
                    {w?.name ?? "Worker"} · {r.crop === "PEPPER" ? "pepper" : "coffee"}
                  </p>
                  <p className="text-sm text-muted">
                    {fields.find((f) => f.id === r.fieldId)?.name}
                    {r.voided ? " · cancelled" : r.status === "accepted" && r.version > 1 ? " · corrected" : ""}
                  </p>
                  {r.message && r.status !== "accepted" && <p className="text-sm text-bad">{r.message}</p>}
                </div>
                <dl className="ml-auto grid grid-cols-3 gap-x-4 text-right text-sm tabular-nums">
                  <div>
                    <dt className="text-xs text-muted">Gross kg</dt>
                    <dd className={r.voided ? "line-through" : ""}>{r.grossKg}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">Tare kg</dt>
                    <dd className={r.voided ? "line-through" : ""}>{r.tareKg}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">Net kg</dt>
                    <dd className={r.voided ? "font-semibold line-through" : "font-semibold"}>{r.netKg}</dd>
                  </div>
                </dl>
                <div className="flex items-center gap-2">
                  <StatusBadge status={r.status} compact />
                  {!r.voided && r.status === "accepted" && app.can("muster.correct") && app.online && server.data?.some((e) => e.id === r.id) && (
                    <Button size="sm" variant="ghost" onClick={() => setCorrecting(r.id)}>
                      Edit
                    </Button>
                  )}
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
      {correcting &&
        (() => {
          const entry = server.data?.find((e) => e.id === correcting);
          if (!entry || !ref) return null;
          return (
            <CorrectWeighIn estateId={estateId} date={date} workerName={workers.find((w) => w.id === entry.workerId)?.name ?? "Worker"} entry={entry} ref={ref} onClose={() => setCorrecting(null)} />
          );
        })()}
    </div>
  );
}
