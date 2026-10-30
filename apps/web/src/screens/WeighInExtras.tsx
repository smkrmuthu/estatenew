import { computeWeighIn, formatKg, parseKg, WeightError } from "@cemms/domain";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Button, Drawer, Field, Input, Notice, Select } from "../components/ui";
import { ApiError, api } from "../lib/api";
import { useCrops } from "../lib/crops";
import type { ReferenceData } from "../lib/db";
import { normalizeKg } from "../lib/kg";

const KG_TEXT = /^\d{0,7}(\.\d{0,3})?$/;

export interface CorrectableEntry {
  id: string;
  version: number;
  fieldId: string;
  crop: string;
  varietyId?: string | null;
  subdivision?: string | null;
  grossG: number;
  tareG?: number;
  bags: number;
  remarks?: string | null;
}

interface Revision {
  id: string;
  version: number;
  change: string;
  reason: string | null;
  actorName: string | null;
  at: string;
  data: { fieldId?: string; varietyId?: string | null; crop?: string; grossG?: number; tareG?: number; netG?: number; bags?: number; remarks?: string | null; status?: string };
}

const CHANGE_LABEL: Record<string, string> = { create: "Recorded", correct: "Corrected", void: "Cancelled" };

/** What this version changed compared with the one before it, in plain words. */
function describeChange(now: Revision, before: Revision | undefined, ref: ReferenceData): string[] {
  const d = now.data;
  const fieldName = (id?: string) => ref.fields.find((f) => f.id === id)?.name ?? "?";
  const varietyName = (id?: string | null) => (id ? (ref.varieties.find((v) => v.id === id)?.name ?? "?") : "not recorded");
  const kg = (g?: number) => formatKg(g ?? 0);
  if (!before) return [`Gross ${kg(d.grossG)} kg`, `Bag wt ${kg(d.tareG)} kg`, `Net ${kg(d.netG)} kg`, `${d.bags ?? 0} bag${d.bags === 1 ? "" : "s"}`, fieldName(d.fieldId), varietyName(d.varietyId)];
  const b = before.data;
  const out: string[] = [];
  if (d.grossG !== b.grossG) out.push(`Gross ${kg(b.grossG)} → ${kg(d.grossG)} kg`);
  if (d.tareG !== b.tareG) out.push(`Bag wt ${kg(b.tareG)} → ${kg(d.tareG)} kg`);
  if (d.netG !== b.netG) out.push(`Net ${kg(b.netG)} → ${kg(d.netG)} kg`);
  if (d.bags !== b.bags) out.push(`Bags ${b.bags ?? 0} → ${d.bags ?? 0}`);
  if (d.fieldId !== b.fieldId) out.push(`Field ${fieldName(b.fieldId)} → ${fieldName(d.fieldId)}`);
  if (d.varietyId !== b.varietyId) out.push(`Variety ${varietyName(b.varietyId)} → ${varietyName(d.varietyId)}`);
  if (d.crop !== b.crop) out.push(`Crop ${b.crop === "PEPPER" ? "Pepper" : "Coffee"} → ${d.crop === "PEPPER" ? "Pepper" : "Coffee"}`);
  if ((d.remarks ?? "") !== (b.remarks ?? "")) out.push("Remark changed");
  if (d.status === "VOID" && b.status !== "VOID") out.push("Weigh-in cancelled");
  return out;
}

/** Every version of one weigh-in, newest first, with who changed it, when, and why. */
export function ChangeHistory({ estateId, entryId, ref }: { estateId: string; entryId: string; ref: ReferenceData }) {
  const q = useQuery({
    queryKey: ["muster-history", entryId],
    queryFn: () => api<Revision[]>(`/audit/history?entityType=muster_entry&entityId=${entryId}&estateId=${estateId}`),
  });
  const timeZone = ref.estates.find((e) => e.id === estateId)?.timeZone ?? "Asia/Kolkata";
  const versions = [...(q.data ?? [])].sort((a, b) => a.version - b.version);
  const when = (at: string) => new Date(at).toLocaleString("en-IN", { timeZone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const newestFirst = versions.map((v, i) => ({ v, changes: describeChange(v, versions[i - 1], ref) })).reverse();
  return (
    <section aria-label="Change history">
      <h3 className="text-sm font-semibold">
        Change history
        {versions.length > 0 && (
          <span className="ml-2 font-normal text-muted">
            {versions.length} version{versions.length === 1 ? "" : "s"}
          </span>
        )}
      </h3>
      {q.isLoading && <p className="mt-2 text-sm text-muted">Loading…</p>}
      {q.isError && <p className="mt-2 text-sm text-bad">The history could not be loaded.</p>}
      {q.data && versions.length === 0 && <p className="mt-2 text-sm text-muted">No earlier versions.</p>}
      {versions.length > 0 && (
        <div className="mt-2 overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[30rem] text-left text-sm">
            <thead className="border-b border-line bg-bg text-[0.8rem] text-muted">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  Version
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  When
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  By
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  What changed
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Reason
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line align-top">
              {newestFirst.map(({ v, changes }) => (
                <tr key={v.id}>
                  <td className="whitespace-nowrap px-3 py-2">
                    <span className="font-semibold tabular-nums">{v.version}</span>
                    <span className="block text-xs text-muted">{CHANGE_LABEL[v.change] ?? v.change}</span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">{when(v.at)}</td>
                  <td className="px-3 py-2">{v.actorName ?? "A user"}</td>
                  <td className="px-3 py-2">
                    {changes.map((c) => (
                      <span key={c} className="block">
                        {c}
                      </span>
                    ))}
                  </td>
                  <td className="px-3 py-2">{v.reason ?? <span className="text-muted">–</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** The change history of one weigh-in on its own, opened from the "corrected" or "cancelled" label in the table. */
export function WeighInHistory({ estateId, entryId, workerName, ref, onClose }: { estateId: string; entryId: string; workerName: string; ref: ReferenceData; onClose: () => void }) {
  return (
    <Drawer title={workerName} subtitle="Change history" onClose={onClose}>
      <ChangeHistory estateId={estateId} entryId={entryId} ref={ref} />
    </Drawer>
  );
}

/**
 * A manager's correction of one saved weigh-in. The old values stay in the history with the reason
 * and the time; the weights are worked out again on the server.
 */
export function CorrectWeighIn({ estateId, workerName, entry, ref, onClose }: { estateId: string; workerName: string; entry: CorrectableEntry; ref: ReferenceData; onClose: () => void }) {
  const qc = useQueryClient();
  const fields = useMemo(() => ref.fields.filter((f) => f.estateId === estateId), [ref, estateId]);
  const [fieldId, setFieldId] = useState(entry.fieldId);
  const [crop, setCrop] = useState(entry.crop);
  const [varietyId, setVarietyId] = useState(entry.varietyId ?? "");
  const [gross, setGross] = useState(formatKg(entry.grossG));
  const [bags, setBags] = useState(entry.bags);
  const [tare, setTare] = useState(entry.tareG ? formatKg(entry.tareG) : "");
  const [remarks, setRemarks] = useState(entry.remarks ?? "");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const field = fields.find((f) => f.id === fieldId);
  const crops = field?.crops ?? [crop];
  const { pepper } = useCrops();
  const required = ref.rules?.varietyRequired !== false;

  // The same rule as the weigh-in form: a field with bearing subdivisions offers their varieties, otherwise the field's list.
  const choices = useMemo(() => {
    const byVariety = new Map<string, { id: string; name: string; letters: string[] }>();
    for (const s of field?.subdivisions ?? []) {
      const v = ref.varieties.find((x) => x.id === s.varietyId);
      if (s.landUse !== "BEARING" || !v || v.crop !== crop) continue;
      const cur = byVariety.get(v.id) ?? { id: v.id, name: v.name, letters: [] };
      cur.letters.push(s.label);
      byVariety.set(v.id, cur);
    }
    return [...byVariety.values()];
  }, [field, ref, crop]);
  const plain = ref.varieties.filter((v) => v.crop === crop && (!field?.varietyIds.length || field.varietyIds.includes(v.id)));
  const options = choices.length ? choices.map((c) => ({ id: c.id, name: `${c.name} (${c.letters.join(", ")})` })) : plain.map((v) => ({ id: v.id, name: v.name }));
  const unchanged = fieldId === entry.fieldId && crop === entry.crop && varietyId === (entry.varietyId ?? "");

  const preview = (() => {
    if (!gross) return { net: null as string | null, error: null as string | null };
    try {
      return { net: formatKg(computeWeighIn({ grossGrams: parseKg(normalizeKg(gross)), bags, tareGrams: tare ? parseKg(normalizeKg(tare)) : 0 }, "MANUAL").netGrams), error: null };
    } catch (e) {
      return { net: null, error: e instanceof WeightError ? e.message : "Check the weight" };
    }
  })();

  async function save() {
    if (!preview.net || !fieldId) return;
    if (required && !varietyId) return setError("Pick the variety.");
    if (reason.trim().length < 3) return setError("Give a reason for the correction.");
    setBusy(true);
    setError("");
    // The subdivision letter stays when nothing it depends on changed; otherwise it is filled in only when one bearing subdivision carries the variety.
    const c = choices.find((x) => x.id === varietyId);
    const subdivision = unchanged ? (entry.subdivision ?? null) : c && c.letters.length === 1 ? (c.letters[0] ?? null) : null;
    try {
      await api(`/muster-entries/${entry.id}/corrections`, {
        body: {
          fieldId,
          subdivision,
          crop,
          varietyId: varietyId || null,
          grossKg: normalizeKg(gross),
          bags,
          tareKg: tare ? normalizeKg(tare) : null,
          remarks: remarks.trim() || null,
          reason: reason.trim(),
          baseVersion: entry.version,
        },
      });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["muster", estateId] }),
        qc.invalidateQueries({ queryKey: ["muster-range"] }),
        qc.invalidateQueries({ queryKey: ["muster-history", entry.id] }),
        qc.invalidateQueries({ queryKey: ["muster-days"] }),
        qc.invalidateQueries({ queryKey: ["dashboard"] }),
        qc.invalidateQueries({ queryKey: ["summary"] }),
      ]);
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer title={workerName} subtitle="Correct weigh-in" onClose={onClose}>
      <p className="text-sm text-muted">The old weigh-in stays in the history with your reason and the time of the correction. The net weight is worked out again.</p>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Field" htmlFor="cw-field">
            <Select
              id="cw-field"
              value={fieldId}
              onChange={(e) => {
                setFieldId(e.target.value);
                const f = fields.find((x) => x.id === e.target.value);
                if (f && !f.crops.includes(crop)) setCrop(f.crops[0] ?? crop);
                setVarietyId("");
              }}
            >
              {fields.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </Select>
          </Field>
          {(pepper || crop === "PEPPER") && (
            <Field label="Crop" htmlFor="cw-crop">
              <Select
                id="cw-crop"
                value={crop}
                onChange={(e) => {
                  setCrop(e.target.value);
                  setVarietyId("");
                }}
              >
                {["COFFEE", "PEPPER"].map((c) => (
                  <option key={c} value={c} disabled={!crops.includes(c)}>
                    {c === "COFFEE" ? "Coffee" : "Pepper"}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label={required ? "Variety" : "Variety (optional)"} htmlFor="cw-variety">
            <Select id="cw-variety" value={varietyId} onChange={(e) => setVarietyId(e.target.value)}>
              <option value="">{required ? "Pick the variety…" : "Not recorded"}</option>
              {options.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Gross weight (kg)" htmlFor="cw-gross" error={preview.error ?? undefined}>
            <Input id="cw-gross" inputMode="decimal" className="font-mono" value={gross} onChange={(e) => KG_TEXT.test(e.target.value) && setGross(e.target.value)} />
          </Field>
          <Field label="Bags" htmlFor="cw-bags">
            <Input id="cw-bags" inputMode="numeric" value={bags} onChange={(e) => setBags(Math.min(100, Number(e.target.value.replace(/\D/g, "")) || 0))} />
          </Field>
          <Field label="Bag wt (kg)" htmlFor="cw-tare" hint="Bag weight to take off, if any">
            <Input id="cw-tare" inputMode="decimal" placeholder="0" value={tare} onChange={(e) => KG_TEXT.test(e.target.value) && setTare(e.target.value)} />
          </Field>
        </div>
        <Field label="Remark (optional)" htmlFor="cw-remark">
          <Input id="cw-remark" maxLength={500} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </Field>
        <p className="text-lg">
          Net: <strong className="text-2xl">{preview.net ?? "–"}</strong> kg
        </p>
        <Field label="Reason for the correction" htmlFor="cw-reason" hint="For example: scale misread">
          <Input id="cw-reason" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        {error && <Notice tone="bad">{error}</Notice>}
        <div className="flex gap-2">
          <Button type="submit" disabled={busy || !preview.net}>
            Save correction
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
      <ChangeHistory estateId={estateId} entryId={entry.id} ref={ref} />
    </Drawer>
  );
}
