import { formatKg, formatScaled, parseKg, parseScaled, WeightError } from "@cemms/domain";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { useApp } from "../app-context";
import { Button, Card, Chip, Drawer, Field, FilterBar, FilterSearch, FilterSelect, Input, Notice, Select } from "../components/ui";
import { ApiError, api } from "../lib/api";
import { useCrops } from "../lib/crops";
import { EMPLOYMENT_LABEL, type EmploymentType, type Gender, type LandUse, type ReferenceData } from "../lib/db";
import { normalizeKg } from "../lib/kg";
import { useDashboards } from "./Dashboard";

type Tab = "fields" | "workers" | "varieties" | "jobs" | "logkinds" | "tare";
type Target = { tab: Tab; id?: string } | null;

const LAND_LABEL: Record<LandUse, string> = { BEARING: "Bearing", YOUNG: "Young plants", ROCK: "Rock", WATER: "Water", EMPTY: "Empty", OTHER_CROP: "Other crop" };
const GENDER_LABEL: Record<Gender, string> = { MALE: "Male", FEMALE: "Female" };
const acres = (c: number | null | undefined) => (c === null || c === undefined ? "–" : (c / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 }));
const msg = (e: unknown) => (e instanceof ApiError ? e.message : "Could not reach the server.");

const statusChip = (active: boolean | undefined) => (active === false ? <Chip>Inactive</Chip> : <Chip tone="ok">Active</Chip>);

function EditLink({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} className="min-h-9 px-2 font-medium text-roast hover:underline">
      Edit
    </button>
  );
}

function Th({ children, right }: { children?: ReactNode; right?: boolean }) {
  return <th className={`px-3 py-2 text-[0.8rem] font-medium text-muted ${right ? "text-right" : "text-left"}`}>{children}</th>;
}
const Td = ({ children, right, className = "" }: { children?: ReactNode; right?: boolean; className?: string }) => (
  <td className={`px-3 py-2.5 align-top tabular-nums ${right ? "text-right" : ""} ${className}`}>{children}</td>
);

/** Shared bits for every drawer form: error line, submit and cancel. */
function FormActions({ busy, error, submit, onCancel, disabled }: { busy: boolean; error: string; submit: string; onCancel: () => void; disabled?: boolean }) {
  return (
    <>
      {error && <Notice tone="bad">{error}</Notice>}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy || disabled}>
          {submit}
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </>
  );
}

function useSaver(done: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      done();
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, save };
}

function EstateSelect({ estates, value, onChange, locked }: { estates: ReferenceData["estates"]; value: string; onChange: (v: string) => void; locked: boolean }) {
  return (
    <Field label="Estate" htmlFor="m-estate">
      <Select id="m-estate" value={value} disabled={locked} onChange={(e) => onChange(e.target.value)}>
        {estates.map((e) => (
          <option key={e.id} value={e.id}>
            {e.name}
          </option>
        ))}
      </Select>
    </Field>
  );
}

/* ---------- Workers ---------- */

function WorkerForm({ data, id, estateId, done }: { data: ReferenceData; id?: string; estateId: string; done: () => void }) {
  const w = id ? data.workers.find((x) => x.id === id) : undefined;
  const [estates, setEstates] = useState<string[]>(w?.estateIds ?? [w?.estateId ?? estateId]);
  const [name, setName] = useState(w?.name ?? "");
  const [gender, setGender] = useState<string>(w?.gender ?? "");
  const [type, setType] = useState<string>(w?.employmentType ?? "PERMANENT");
  const [area, setArea] = useState(w?.area ?? "");
  const [active, setActive] = useState(w?.active !== false);
  const { busy, error, setError, save } = useSaver(done);
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return setError("Enter the worker's name.");
        if (estates.length === 0) return setError("Choose at least one estate for this worker.");
        void save(() =>
          api(w ? `/workers/${w.id}` : "/workers", {
            method: w ? "PUT" : "POST",
            ...(w ? { headers: { "if-match": String(w.version ?? 1) } } : {}),
            body: {
              estateId: w && estates.includes(w.estateId) ? w.estateId : (estates[0] ?? estateId),
              estateIds: estates,
              name: name.trim(),
              gender: gender || null,
              employmentType: type || null,
              area: area.trim() || null,
              active,
            },
          }),
        );
      }}
    >
      <fieldset className="m-0 min-w-0 border-0 p-0">
        <legend className="mb-1 text-sm font-medium">Estates the worker works in</legend>
        <div className="flex flex-wrap gap-4">
          {data.estates.map((e) => (
            <label key={e.id} className="flex min-h-10 items-center gap-2 text-sm">
              <input type="checkbox" checked={estates.includes(e.id)} onChange={(ev) => setEstates((cur) => (ev.target.checked ? [...cur, e.id] : cur.filter((x) => x !== e.id)))} />
              {e.name}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Name" htmlFor="w-name">
          <Input id="w-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Area (where from)" htmlFor="w-area">
          <Input id="w-area" value={area} maxLength={120} onChange={(e) => setArea(e.target.value)} />
        </Field>
        <Field label="Gender" htmlFor="w-gender">
          <Select id="w-gender" value={gender} onChange={(e) => setGender(e.target.value)}>
            <option value="">Select</option>
            <option value="MALE">Male</option>
            <option value="FEMALE">Female</option>
          </Select>
        </Field>
        <Field label="Type" htmlFor="w-type">
          <Select id="w-type" value={type} onChange={(e) => setType(e.target.value)}>
            {(Object.keys(EMPLOYMENT_LABEL) as EmploymentType[]).map((t) => (
              <option key={t} value={t}>
                {EMPLOYMENT_LABEL[t]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Status" htmlFor="w-active">
        <Select id="w-active" className="sm:max-w-48" value={active ? "1" : "0"} onChange={(e) => setActive(e.target.value === "1")}>
          <option value="1">Active</option>
          <option value="0">Inactive (left the estate)</option>
        </Select>
      </Field>
      <p className="text-sm text-muted">New and reactivated workers appear in the next attendance register that is not yet approved.</p>
      <FormActions busy={busy} error={error} submit={w ? "Save changes" : "Add worker"} onCancel={done} />
    </form>
  );
}

interface Pick {
  sel: Set<string>;
  toggle: (id: string) => void;
  toggleAll: (ids: string[], on: boolean) => void;
}

function SelectBox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (on: boolean) => void }) {
  return <input type="checkbox" aria-label={label} checked={checked} onChange={(e) => onChange(e.target.checked)} />;
}

function Workers({ data, canWrite, open, pick }: { data: ReferenceData; canWrite: (estateId: string) => boolean; open: (id: string) => void; pick: Pick }) {
  const [q, setQ] = useState("");
  const [fEstate, setFEstate] = useState("");
  const [fType, setFType] = useState("");
  const [fArea, setFArea] = useState("");
  const [fGender, setFGender] = useState("");
  const [fStatus, setFStatus] = useState("");
  const all = data.workers;
  const ws = all.filter(
    (w) =>
      (!q || `${w.name} ${w.employeeCode}`.toLowerCase().includes(q.toLowerCase())) &&
      (!fEstate || (w.estateIds ?? [w.estateId]).includes(fEstate)) &&
      (!fType || w.employmentType === fType) &&
      (!fArea || (w.area ?? "") === fArea) &&
      (!fGender || (w.gender ?? "") === fGender) &&
      (!fStatus || (fStatus === "active" ? w.active !== false : w.active === false)),
  );
  const areas = [...new Set(all.map((w) => w.area).filter((a): a is string => !!a))].sort();
  const filtersOn = !!(q || fEstate || fType || fArea || fGender || fStatus);
  const code = new Map(data.estates.map((e) => [e.id, e.code]));
  return (
    <Card title="Workers" actions={<span className="text-sm text-muted">{all.filter((w) => w.active !== false).length} active workers</span>}>
      <div className="mb-3 flex flex-col gap-3">
        <FilterSearch label="Find a worker" value={q} onChange={setQ} placeholder="Name or code" />
        <FilterBar
          shown={ws.length}
          total={all.length}
          noun="workers"
          active={filtersOn}
          onClear={() => {
            setQ("");
            setFEstate("");
            setFType("");
            setFArea("");
            setFGender("");
            setFStatus("");
          }}
        >
          <FilterSelect label="Estate" value={fEstate} onChange={setFEstate} options={[{ value: "", label: "All estates" }, ...data.estates.map((e) => ({ value: e.id, label: e.name }))]} />
          <FilterSelect
            label="Type"
            value={fType}
            onChange={setFType}
            options={[{ value: "", label: "All types" }, ...(Object.keys(EMPLOYMENT_LABEL) as EmploymentType[]).map((t) => ({ value: t, label: EMPLOYMENT_LABEL[t] }))]}
          />
          <FilterSelect label="Area" value={fArea} onChange={setFArea} options={[{ value: "", label: "All areas" }, ...areas.map((a) => ({ value: a, label: a }))]} />
          <FilterSelect
            label="Gender"
            value={fGender}
            onChange={setFGender}
            options={[
              { value: "", label: "Everyone" },
              { value: "FEMALE", label: "Female" },
              { value: "MALE", label: "Male" },
            ]}
          />
          <FilterSelect
            label="Status"
            value={fStatus}
            onChange={setFStatus}
            options={[
              { value: "", label: "Active and inactive" },
              { value: "active", label: "Active" },
              { value: "inactive", label: "Inactive" },
            ]}
          />
        </FilterBar>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] text-sm">
          <thead className="border-b border-line">
            <tr>
              <Th>
                <SelectBox
                  label="Select all workers"
                  checked={ws.length > 0 && ws.filter((w) => canWrite(w.estateId)).every((w) => pick.sel.has(w.id))}
                  onChange={(on) =>
                    pick.toggleAll(
                      ws.filter((w) => canWrite(w.estateId)).map((w) => w.id),
                      on,
                    )
                  }
                />
              </Th>
              <Th>Code</Th>
              <Th>Name</Th>
              <Th>Estates</Th>
              <Th>Area</Th>
              <Th>Gender</Th>
              <Th>Type</Th>
              <Th>Status</Th>
              <Th />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {ws.map((w) => (
              <tr key={w.id}>
                <Td>{canWrite(w.estateId) && <SelectBox label={`Select ${w.name}`} checked={pick.sel.has(w.id)} onChange={() => pick.toggle(w.id)} />}</Td>
                <Td className="whitespace-nowrap font-mono">{w.employeeCode}</Td>
                <Td>{w.name}</Td>
                <Td>
                  <span className="flex flex-wrap gap-1">
                    {(w.estateIds ?? [w.estateId]).map((id) => (
                      <Chip key={id} tone="plain">
                        {code.get(id) ?? "?"}
                      </Chip>
                    ))}
                  </span>
                </Td>
                <Td>{w.area || <span className="text-muted">Not set</span>}</Td>
                <Td>
                  {w.gender ? (
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${w.gender === "FEMALE" ? "bg-cherry/15 text-cherry" : "bg-info/15 text-info"}`}>{GENDER_LABEL[w.gender]}</span>
                  ) : (
                    <span className="text-muted">Not set</span>
                  )}
                </Td>
                <Td>{w.employmentType ? <Chip tone={w.employmentType === "PERMANENT" ? "plain" : "warn"}>{EMPLOYMENT_LABEL[w.employmentType]}</Chip> : <span className="text-muted">Not set</span>}</Td>
                <Td>{statusChip(w.active)}</Td>
                <Td right>{canWrite(w.estateId) && <EditLink label={`Edit ${w.name}`} onClick={() => open(w.id)} />}</Td>
              </tr>
            ))}
            {ws.length === 0 && (
              <tr>
                <Td className="text-muted">{filtersOn ? "No workers match these filters." : "No workers yet."}</Td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/* ---------- Fields ---------- */

interface SubRow {
  landUse: LandUse;
  varietyId: string;
  acres: string;
}

function toCenti(text: string): number | null {
  const m = /^(\d{1,5})(?:\.(\d{1,2}))?$/.exec(text.trim());
  return m ? Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0")) : null;
}

function FieldForm({ data, id, estateId, done }: { data: ReferenceData; id?: string; estateId: string; done: () => void }) {
  const f = id ? data.fields.find((x) => x.id === id) : undefined;
  const [estate, setEstate] = useState(f?.estateId ?? estateId);
  const [name, setName] = useState(f?.name ?? "");
  const [total, setTotal] = useState(f?.areaCentiAcres ? String(f.areaCentiAcres / 100) : "");
  const [expected, setExpected] = useState(String(f?.expectedCherryKg ?? 0));
  const [elevation, setElevation] = useState(f?.elevationM ? String(f.elevationM) : "");
  const [active, setActive] = useState(f?.active !== false);
  const [crops, setCrops] = useState<string[]>(f?.crops ?? ["COFFEE"]);
  const { pepper } = useCrops();
  const [subs, setSubs] = useState<SubRow[]>(
    f?.subdivisions?.length
      ? f.subdivisions.map((s) => ({ landUse: s.landUse, varietyId: s.varietyId ?? "", acres: String((s.areaCentiAcres ?? 0) / 100) }))
      : [{ landUse: "BEARING", varietyId: "", acres: "" }],
  );
  const { busy, error, setError, save } = useSaver(done);
  const sum = subs.reduce((s, r) => s + (toCenti(r.acres) ?? 0), 0);
  const totalCenti = toCenti(total);
  const varieties = data.varieties.filter((v) => crops.includes(v.crop));
  const patch = (i: number, p: Partial<SubRow>) => setSubs((rows) => rows.map((r, j) => (j === i ? { ...r, ...p } : r)));

  function submit() {
    if (!name.trim()) return setError("Give the field a name.");
    if (data.fields.some((x) => x.estateId === estate && x.id !== f?.id && x.name.toLowerCase() === name.trim().toLowerCase())) return setError("Another field in this estate already has that name.");
    if (!totalCenti) return setError("Enter the total acres, for example 10.75.");
    const filled = subs.filter((r) => (toCenti(r.acres) ?? 0) > 0);
    if (subs.some((r) => r.acres.trim() && toCenti(r.acres) === null)) return setError("Acres need a number with up to 2 decimals.");
    if (filled.length && sum !== totalCenti) return setError(`Subdivisions add up to ${sum / 100} acres, but the field is ${totalCenti / 100} acres. Make them match.`);
    if (filled.some((r) => r.landUse === "BEARING" && !r.varietyId)) return setError("Bearing subdivisions need a variety.");
    if (crops.length === 0) return setError("Choose at least one crop.");
    void save(() =>
      api(f ? `/fields/${f.id}` : "/fields", {
        method: f ? "PUT" : "POST",
        ...(f ? { headers: { "if-match": String(f.version ?? 1) } } : {}),
        body: {
          estateId: estate,
          name: name.trim(),
          areaCentiAcres: totalCenti,
          expectedCherryKg: Number(expected) || 0,
          elevationM: elevation.trim() ? Number(elevation) : null,
          crops,
          active,
          ...(filled.length
            ? { subdivisions: filled.map((r) => ({ landUse: r.landUse, varietyId: r.landUse === "BEARING" || r.landUse === "YOUNG" ? r.varietyId || null : null, areaCentiAcres: toCenti(r.acres) })) }
            : { varietyIds: f?.varietyIds ?? [] }),
        },
      }),
    );
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <EstateSelect estates={data.estates} value={estate} onChange={setEstate} locked={!!f} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Field name" htmlFor="f-name">
          <Input id="f-name" placeholder="For example Middle Field" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Total acres" htmlFor="f-total">
          <Input id="f-total" inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} />
        </Field>
        <Field label="Expected cherry this season (kg)" htmlFor="f-exp">
          <Input id="f-exp" inputMode="numeric" value={expected} onChange={(e) => setExpected(e.target.value.replace(/\D/g, ""))} />
        </Field>
        <Field label="Elevation (m)" htmlFor="f-elev">
          <Input id="f-elev" inputMode="numeric" value={elevation} onChange={(e) => setElevation(e.target.value.replace(/\D/g, ""))} />
        </Field>
        <Field label="Status" htmlFor="f-active">
          <Select id="f-active" value={active ? "1" : "0"} onChange={(e) => setActive(e.target.value === "1")}>
            <option value="1">Active</option>
            <option value="0">Inactive</option>
          </Select>
        </Field>
      </div>
      {(pepper || crops.includes("PEPPER")) && (
        <fieldset className="flex flex-wrap items-center gap-x-5 gap-y-1">
          <legend className="mb-1 text-[0.8rem] font-medium text-muted">Crops grown</legend>
          {[
            ["COFFEE", "Coffee"],
            ["PEPPER", "Pepper"],
          ].map(([c, label]) => (
            <label key={c} className="flex min-h-9 items-center gap-2">
              <input type="checkbox" checked={crops.includes(c as string)} onChange={(e) => setCrops(e.target.checked ? [...crops, c as string] : crops.filter((x) => x !== c))} /> {label}
            </label>
          ))}
        </fieldset>
      )}

      <div>
        <h3>Subdivisions</h3>
        <p className="mt-1 text-sm text-muted">Each part of the field with one land use and at most one variety. Plucking is only offered on bearing subdivisions.</p>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[30rem] text-sm">
            <thead className="border-b border-line">
              <tr>
                <Th />
                <Th>Land use</Th>
                <Th>Variety</Th>
                <Th right>Acres</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {subs.map((r, i) => {
                const letter = String.fromCharCode(65 + i);
                const takesVariety = r.landUse === "BEARING" || r.landUse === "YOUNG";
                return (
                  // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional (A, B, C) and have no other identity
                  <tr key={i} className="border-b border-line">
                    <Td className="font-mono text-muted">{letter}</Td>
                    <Td>
                      <Select aria-label={`Land use ${letter}`} className="!min-h-10" value={r.landUse} onChange={(e) => patch(i, { landUse: e.target.value as LandUse })}>
                        {(Object.keys(LAND_LABEL) as LandUse[]).map((l) => (
                          <option key={l} value={l}>
                            {LAND_LABEL[l]}
                          </option>
                        ))}
                      </Select>
                    </Td>
                    <Td>
                      <Select
                        aria-label={`Variety ${letter}`}
                        className="!min-h-10"
                        disabled={!takesVariety}
                        value={takesVariety ? r.varietyId : ""}
                        onChange={(e) => patch(i, { varietyId: e.target.value })}
                      >
                        <option value="">None</option>
                        {varieties.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.name}
                          </option>
                        ))}
                      </Select>
                    </Td>
                    <Td right>
                      <Input aria-label={`Acres ${letter}`} inputMode="decimal" className="!min-h-10 !w-24 text-right" value={r.acres} onChange={(e) => patch(i, { acres: e.target.value })} />
                    </Td>
                    <Td right>
                      {subs.length > 1 && (
                        <button type="button" aria-label={`Remove subdivision ${letter}`} className="min-h-9 px-2 text-muted hover:text-bad" onClick={() => setSubs(subs.filter((_, j) => j !== i))}>
                          Remove
                        </button>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <Button variant="secondary" disabled={subs.length >= 26} onClick={() => setSubs([...subs, { landUse: "BEARING", varietyId: "", acres: "" }])}>
            Add subdivision
          </Button>
          <span className="text-sm text-muted" aria-live="polite">
            Subdivisions: {sum / 100} of {totalCenti ? totalCenti / 100 : 0} acres{totalCenti && sum && sum !== totalCenti ? " (should match)" : ""}
          </span>
        </div>
      </div>
      <FormActions busy={busy} error={error} submit={f ? "Save changes" : "Add field"} onCancel={done} />
    </form>
  );
}

function Fields({
  data,
  canWrite,
  open,
  pick,
  season,
}: {
  data: ReferenceData;
  canWrite: (estateId: string) => boolean;
  open: (id: string) => void;
  pick: Pick;
  season: { start: string | null; to: string };
}) {
  const app = useApp();
  const { pepper } = useCrops();
  // Coffee plucked on each field since the season started, to compare with the expected cherry.
  const plucked = useQueries({
    queries: season.start
      ? data.estates.map((e) => ({
          queryKey: ["season", e.id, season.start, season.to],
          queryFn: () => api<{ byField: { fieldId: string; coffeeNetG: number }[] }>(`/estates/${e.id}/reports/plucking?from=${season.start}&to=${season.to}`),
          enabled: app.online && app.can("reports.read", e.id),
        }))
      : [],
  });
  const pluckedG = new Map(plucked.flatMap((r) => (r.data?.byField ?? []).map((f) => [f.fieldId, f.coffeeNetG] as const)));
  const varietyName = (id: string | null) => data.varieties.find((v) => v.id === id)?.name;
  const [q, setQ] = useState("");
  const [fEstate, setFEstate] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fCrop, setFCrop] = useState("");
  const [fVariety, setFVariety] = useState("");
  const matches = (f: ReferenceData["fields"][number]) =>
    (!q || `${f.name} ${f.code}`.toLowerCase().includes(q.toLowerCase())) &&
    (!fEstate || f.estateId === fEstate) &&
    (!fStatus || (fStatus === "active" ? f.active !== false : f.active === false)) &&
    (!fCrop || (f.crops ?? []).includes(fCrop as "COFFEE" | "PEPPER")) &&
    (!fVariety || (f.varietyIds ?? []).includes(fVariety) || (f.subdivisions ?? []).some((s) => s.varietyId === fVariety));
  const filtersOn = !!(q || fEstate || fStatus || fCrop || fVariety);
  return (
    <>
      <FilterBar
        shown={data.fields.filter(matches).length}
        total={data.fields.length}
        noun="fields"
        active={filtersOn}
        onClear={() => {
          setQ("");
          setFEstate("");
          setFStatus("");
          setFCrop("");
          setFVariety("");
        }}
      >
        <FilterSearch label="Find a field" value={q} onChange={setQ} placeholder="Name or code" />
        <FilterSelect label="Estate" value={fEstate} onChange={setFEstate} options={[{ value: "", label: "All estates" }, ...data.estates.map((e) => ({ value: e.id, label: e.name }))]} />
        {pepper && (
          <FilterSelect
            label="Crop"
            value={fCrop}
            onChange={setFCrop}
            options={[
              { value: "", label: "Coffee and pepper" },
              { value: "COFFEE", label: "Coffee" },
              { value: "PEPPER", label: "Pepper" },
            ]}
          />
        )}
        <FilterSelect
          label="Variety"
          value={fVariety}
          onChange={setFVariety}
          options={[{ value: "", label: "All varieties" }, ...data.varieties.filter((v) => pepper || v.crop !== "PEPPER").map((v) => ({ value: v.id, label: v.name }))]}
        />
        <FilterSelect
          label="Status"
          value={fStatus}
          onChange={setFStatus}
          options={[
            { value: "", label: "Active and inactive" },
            { value: "active", label: "Active" },
            { value: "inactive", label: "Inactive" },
          ]}
        />
      </FilterBar>
      {data.estates
        .filter((e) => !fEstate || e.id === fEstate)
        .map((e) => {
          const every = data.fields.filter((f) => f.estateId === e.id);
          const fs = every.filter(matches);
          const total = every.reduce((s, f) => s + (f.areaCentiAcres ?? 0), 0);
          const bearing = every.reduce((s, f) => s + (f.subdivisions ?? []).filter((x) => x.landUse === "BEARING").reduce((a, x) => a + (x.areaCentiAcres ?? 0), 0), 0);
          return (
            <Card
              key={e.id}
              title={e.name}
              actions={
                <span className="text-sm text-muted">
                  {every.filter((f) => f.active !== false).length} active fields · {acres(total)} acres · {acres(bearing)} bearing
                </span>
              }
            >
              <div className="overflow-x-auto">
                <table className="w-full min-w-[52rem] text-sm">
                  <thead className="border-b border-line">
                    <tr>
                      <Th>
                        {canWrite(e.id) && (
                          <SelectBox
                            label={`Select all fields in ${e.name}`}
                            checked={fs.length > 0 && fs.every((f) => pick.sel.has(f.id))}
                            onChange={(on) =>
                              pick.toggleAll(
                                fs.map((f) => f.id),
                                on,
                              )
                            }
                          />
                        )}
                      </Th>
                      <Th>Code</Th>
                      <Th>Field</Th>
                      <Th right>Acres</Th>
                      <Th>Subdivisions</Th>
                      <Th right>Expected</Th>
                      <Th right>Plucked</Th>
                      <Th>Progress</Th>
                      <Th>Status</Th>
                      <Th />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {fs.map((f) => (
                      <tr key={f.id}>
                        <Td>{canWrite(e.id) && <SelectBox label={`Select ${f.name}`} checked={pick.sel.has(f.id)} onChange={() => pick.toggle(f.id)} />}</Td>
                        <Td className="whitespace-nowrap font-mono">{f.code}</Td>
                        <Td>
                          {f.name}
                          {f.elevationM ? <span className="block text-xs text-muted">{f.elevationM} m</span> : null}
                        </Td>
                        <Td right>{acres(f.areaCentiAcres)}</Td>
                        <Td>
                          <div className="flex flex-wrap gap-1">
                            {(f.subdivisions ?? []).map((s) => (
                              <Chip key={s.id} tone={s.landUse === "BEARING" ? "ok" : "plain"}>
                                {s.label} · {LAND_LABEL[s.landUse]}
                                {varietyName(s.varietyId) ? ` · ${varietyName(s.varietyId)}` : ""} · {acres(s.areaCentiAcres)} ac
                              </Chip>
                            ))}
                            {!f.subdivisions?.length && <span className="text-muted">None</span>}
                          </div>
                        </Td>
                        <Td right>{f.expectedCherryKg ? `${f.expectedCherryKg.toLocaleString("en-IN")} kg` : "–"}</Td>
                        <Td right>{season.start ? `${Math.round((pluckedG.get(f.id) ?? 0) / 1000).toLocaleString("en-IN")} kg` : "–"}</Td>
                        <Td>
                          {season.start && f.expectedCherryKg ? (
                            (() => {
                              const pct = Math.round(((pluckedG.get(f.id) ?? 0) / 1000 / f.expectedCherryKg) * 100);
                              return (
                                <span className="flex items-center gap-2">
                                  <span className="block h-1.5 w-20 overflow-hidden rounded-full bg-surface-2">
                                    <span className="block h-full rounded-full bg-roast" style={{ width: `${Math.min(100, pct)}%` }} />
                                  </span>
                                  <span className="text-xs text-muted">{pct}%</span>
                                </span>
                              );
                            })()
                          ) : (
                            <span className="text-muted">–</span>
                          )}
                        </Td>
                        <Td>{statusChip(f.active)}</Td>
                        <Td right>{canWrite(e.id) && <EditLink label={`Edit ${f.name}`} onClick={() => open(f.id)} />}</Td>
                      </tr>
                    ))}
                    {fs.length === 0 && (
                      <tr>
                        <Td className="text-muted">{filtersOn ? "No fields match these filters." : "No fields yet."}</Td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          );
        })}
    </>
  );
}

/* ---------- Varieties ---------- */

const CROP_LABEL: Record<string, string> = { COFFEE: "Coffee", PEPPER: "Pepper" };

/** Fields that grow a variety: the ones listed on the field itself, plus those whose subdivisions carry it. */
const fieldsGrowing = (data: ReferenceData, varietyId: string) => data.fields.filter((f) => f.varietyIds.includes(varietyId) || (f.subdivisions ?? []).some((s) => s.varietyId === varietyId));

function VarietyForm({ data, id, done }: { data: ReferenceData; id?: string; done: () => void }) {
  const app = useApp();
  const v = id ? data.varieties.find((x) => x.id === id) : undefined;
  const [code, setCode] = useState(v?.code ?? "");
  const [name, setName] = useState(v?.name ?? "");
  const [crop, setCrop] = useState(v?.crop ?? "COFFEE");
  const { pepper } = useCrops();
  const [active, setActive] = useState(v?.active !== false);
  const hasSubs = (f: ReferenceData["fields"][number]) => (f.subdivisions ?? []).length > 0;
  const [ticked, setTicked] = useState<Set<string>>(new Set(v ? fieldsGrowing(data, v.id).map((f) => f.id) : []));
  const { busy, error, setError, save } = useSaver(done);
  const candidates = data.fields.filter((f) => f.crops.includes(crop));
  const toggle = (fid: string) => setTicked((cur) => new Set(cur.has(fid) ? [...cur].filter((x) => x !== fid) : [...cur, fid]));
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!code.trim() || !name.trim()) return setError("Enter a code and a variety name.");
        // Only fields the variety can be set on from here: those without subdivisions.
        const fieldIds = [...ticked].filter((fid) => {
          const f = data.fields.find((x) => x.id === fid);
          return !!f && !hasSubs(f) && f.crops.includes(crop);
        });
        void save(() =>
          api(v ? `/varieties/${v.id}` : "/varieties", {
            method: v ? "PUT" : "POST",
            ...(v ? { headers: { "if-match": String(v.version ?? 1) } } : {}),
            body: { code: code.trim().toUpperCase(), name: name.trim(), crop, active, fieldIds },
          }),
        );
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Code" htmlFor="v-code" hint="Short, for example CG">
          <Input id="v-code" value={code} onChange={(e) => setCode(e.target.value)} />
        </Field>
        <Field label="Variety" htmlFor="v-name">
          <Input id="v-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        {(pepper || crop === "PEPPER") && (
          <Field label="Crop" htmlFor="v-crop" hint={v ? "The crop cannot be changed once the variety is added" : undefined}>
            <Select id="v-crop" value={crop} disabled={!!v} onChange={(e) => setCrop(e.target.value)}>
              <option value="COFFEE">Coffee</option>
              <option value="PEPPER">Pepper</option>
            </Select>
          </Field>
        )}
        <Field label="Status" htmlFor="v-active">
          <Select id="v-active" value={active ? "1" : "0"} onChange={(e) => setActive(e.target.value === "1")}>
            <option value="1">Active</option>
            <option value="0">Inactive</option>
          </Select>
        </Field>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-semibold">Grown in these fields</legend>
        <p className="text-sm text-muted">
          Weigh-in offers this variety for the fields ticked here. A field that is divided into subdivisions gets its varieties from them; change those on the field.
        </p>
        {candidates.length === 0 && <p className="text-sm text-muted">No field grows {CROP_LABEL[crop]?.toLowerCase() ?? "this crop"} yet.</p>}
        {data.estates.map((e) => {
          const list = candidates.filter((f) => f.estateId === e.id);
          if (list.length === 0) return null;
          return (
            <div key={e.id} className="rounded-xl border border-line p-3">
              <p className="mb-1 text-sm font-semibold">{e.name}</p>
              <ul className="flex flex-col">
                {list.map((f) => {
                  const bySubs = hasSubs(f);
                  const carried = bySubs && (f.subdivisions ?? []).some((s) => s.varietyId === v?.id);
                  const locked = bySubs || !app.can("masters.write", f.estateId);
                  return (
                    <li key={f.id}>
                      <label className={`flex min-h-11 items-center gap-3 ${locked ? "text-muted" : ""}`}>
                        <input type="checkbox" className="size-5" checked={bySubs ? carried : ticked.has(f.id)} disabled={locked} onChange={() => toggle(f.id)} />
                        <span>
                          {f.name} <span className="text-muted">· {f.code}</span>
                          {bySubs && <span className="block text-xs">{carried ? "Set in the field's subdivisions" : "Divided into subdivisions: choose the variety there"}</span>}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </fieldset>
      <FormActions busy={busy} error={error} submit={v ? "Save changes" : "Add variety"} onCancel={done} />
    </form>
  );
}

function Varieties({ data, canWrite, open }: { data: ReferenceData; canWrite: boolean; open: (id: string) => void }) {
  const { pepper } = useCrops();
  const shown = data.varieties.filter((v) => pepper || v.crop !== "PEPPER");
  return (
    <Card>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] text-sm">
          <thead className="border-b border-line">
            <tr>
              <Th>Code</Th>
              <Th>Variety</Th>
              {pepper && <Th>Crop</Th>}
              <Th>Grown in</Th>
              <Th>Status</Th>
              <Th />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {shown.map((v) => {
              const growing = fieldsGrowing(data, v.id);
              return (
                <tr key={v.id}>
                  <Td className="font-mono">{v.code}</Td>
                  <Td>{v.name}</Td>
                  {pepper && <Td>{CROP_LABEL[v.crop] ?? v.crop}</Td>}
                  <Td className="tabular-nums">{growing.length ? growing.map((f) => f.name).join(", ") : <span className="text-muted">No field yet</span>}</Td>
                  <Td>{statusChip(v.active)}</Td>
                  <Td right>{canWrite && <EditLink label={`Edit ${v.name}`} onClick={() => open(v.id)} />}</Td>
                </tr>
              );
            })}
            {shown.length === 0 && (
              <tr>
                <Td className="text-muted">No varieties yet.</Td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/* ---------- Jobs ---------- */

function JobForm({ data, id, done }: { data: ReferenceData; id?: string; done: () => void }) {
  const j = id ? data.jobTypes.find((x) => x.id === id) : undefined;
  const [code, setCode] = useState(j?.code ?? "");
  const [name, setName] = useState(j?.name ?? "");
  const [plucking, setPlucking] = useState(j?.countsAsPlucking ?? false);
  const [active, setActive] = useState(j?.active !== false);
  const { busy, error, setError, save } = useSaver(done);
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!code.trim() || !name.trim()) return setError("Enter a code and a job name.");
        void save(() =>
          api(j ? `/job-types/${j.id}` : "/job-types", {
            method: j ? "PUT" : "POST",
            ...(j ? { headers: { "if-match": String(j.version ?? 1) } } : {}),
            body: { code: code.trim().toUpperCase(), name: name.trim(), countsAsPlucking: plucking, active },
          }),
        );
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Code" htmlFor="j-code" hint="Short, for example PLK">
          <Input id="j-code" value={code} onChange={(e) => setCode(e.target.value)} />
        </Field>
        <Field label="Job" htmlFor="j-name">
          <Input id="j-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Counts as plucking" htmlFor="j-pluck">
          <Select id="j-pluck" value={plucking ? "1" : "0"} onChange={(e) => setPlucking(e.target.value === "1")}>
            <option value="0">No</option>
            <option value="1">Yes, weighed at the evening muster</option>
          </Select>
        </Field>
        <Field label="Status" htmlFor="j-active">
          <Select id="j-active" value={active ? "1" : "0"} onChange={(e) => setActive(e.target.value === "1")}>
            <option value="1">Active</option>
            <option value="0">Inactive</option>
          </Select>
        </Field>
      </div>
      <FormActions busy={busy} error={error} submit={j ? "Save changes" : "Add job"} onCancel={done} />
    </form>
  );
}

function Jobs({ data, canWrite, open }: { data: ReferenceData; canWrite: boolean; open: (id: string) => void }) {
  return (
    <Card>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[30rem] text-sm">
          <thead className="border-b border-line">
            <tr>
              <Th>Code</Th>
              <Th>Job</Th>
              <Th>Counts as plucking</Th>
              <Th>Status</Th>
              <Th />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {data.jobTypes.map((j) => (
              <tr key={j.id}>
                <Td className="font-mono">{j.code}</Td>
                <Td>{j.name}</Td>
                <Td>{j.countsAsPlucking ? "Yes, weighed at the evening muster" : "No"}</Td>
                <Td>{statusChip(j.active)}</Td>
                <Td right>{canWrite && <EditLink label={`Edit ${j.name}`} onClick={() => open(j.id)} />}</Td>
              </tr>
            ))}
            {data.jobTypes.length === 0 && (
              <tr>
                <Td className="text-muted">No jobs yet.</Td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/* ---------- Daily log kinds ---------- */

function KindForm({ data, id, done }: { data: ReferenceData; id?: string; done: () => void }) {
  const k = id ? data.logKinds.find((x) => x.id === id) : undefined;
  const [code, setCode] = useState(k?.code ?? "");
  const [label, setLabel] = useState(k?.label ?? "");
  const [unit, setUnit] = useState(k?.unit ?? "");
  const [valueType, setValueType] = useState<"NUMBER" | "TEXT">(k?.valueType ?? "NUMBER");
  const [decimals, setDecimals] = useState(String(k?.decimals ?? 1));
  const [min, setMin] = useState(k?.minScaled != null ? formatScaled(k.minScaled, k.decimals) : "");
  const [max, setMax] = useState(k?.maxScaled != null ? formatScaled(k.maxScaled, k.decimals) : "");
  const [perDay, setPerDay] = useState(k?.expectedPerDay ? String(k.expectedPerDay) : "");
  const [active, setActive] = useState(k?.active !== false);
  const { busy, error, setError, save } = useSaver(done);
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!code.trim() || !label.trim()) return setError("Enter a code and a name.");
        const d = valueType === "TEXT" ? 0 : Number(decimals);
        let minScaled: number | null = null;
        let maxScaled: number | null = null;
        try {
          if (valueType === "NUMBER" && min.trim()) minScaled = parseScaled(min, d);
          if (valueType === "NUMBER" && max.trim()) maxScaled = parseScaled(max, d);
        } catch (err) {
          return setError(err instanceof Error ? `Valid range: ${err.message}` : "Check the valid range.");
        }
        void save(() =>
          api(k ? `/admin/log-kinds/${k.id}` : "/admin/log-kinds", {
            method: k ? "PUT" : "POST",
            ...(k ? { headers: { "if-match": String(k.version ?? 1) } } : {}),
            body: {
              code: code.trim().toUpperCase(),
              label: label.trim(),
              unit: unit.trim() || null,
              valueType,
              decimals: d,
              minScaled,
              maxScaled,
              expectedPerDay: perDay ? Number(perDay) : null,
              active,
            },
          }),
        );
      }}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Code" htmlFor="k-code">
          <Input id="k-code" value={code} onChange={(e) => setCode(e.target.value)} />
        </Field>
        <Field label="Kind" htmlFor="k-label">
          <Input id="k-label" placeholder="For example Rain" value={label} onChange={(e) => setLabel(e.target.value)} />
        </Field>
        <Field label="Unit" htmlFor="k-unit">
          <Input id="k-unit" placeholder="For example mm" value={unit} onChange={(e) => setUnit(e.target.value)} />
        </Field>
        <Field label="Type" htmlFor="k-type" hint={k ? "Cannot change once set" : undefined}>
          <Select id="k-type" value={valueType} disabled={!!k} onChange={(e) => setValueType(e.target.value as "NUMBER" | "TEXT")}>
            <option value="NUMBER">Number</option>
            <option value="TEXT">Text</option>
          </Select>
        </Field>
        <Field label="Decimals" htmlFor="k-dec">
          <Select id="k-dec" value={decimals} disabled={!!k || valueType === "TEXT"} onChange={(e) => setDecimals(e.target.value)}>
            {["0", "1", "2", "3"].map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Expected per day" htmlFor="k-per" hint="Leave blank if optional">
          <Input id="k-per" inputMode="numeric" value={perDay} onChange={(e) => setPerDay(e.target.value.replace(/\D/g, ""))} />
        </Field>
        {valueType === "NUMBER" && (
          <>
            <Field label="Lowest valid value" htmlFor="k-min">
              <Input id="k-min" inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} />
            </Field>
            <Field label="Highest valid value" htmlFor="k-max">
              <Input id="k-max" inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value)} />
            </Field>
          </>
        )}
        <Field label="Status" htmlFor="k-active">
          <Select id="k-active" value={active ? "1" : "0"} onChange={(e) => setActive(e.target.value === "1")}>
            <option value="1">Active</option>
            <option value="0">Inactive</option>
          </Select>
        </Field>
      </div>
      <p className="text-sm text-muted">Which readings to take is still to be confirmed with the owner (question OC-100). Add only the readings the estate has agreed.</p>
      <FormActions busy={busy} error={error} submit={k ? "Save changes" : "Add kind"} onCancel={done} />
    </form>
  );
}

function Kinds({ data, canWrite, open }: { data: ReferenceData; canWrite: boolean; open: (id: string) => void }) {
  return (
    <Card title="Daily log kinds" actions={<span className="hidden text-sm text-muted sm:inline">What the supervisor can log. Expected per day is how many readings each estate should have.</span>}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] text-sm">
          <thead className="border-b border-line">
            <tr>
              <Th>Kind</Th>
              <Th>Unit</Th>
              <Th right>Valid range</Th>
              <Th right>Expected per day</Th>
              <Th>Status</Th>
              <Th />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {data.logKinds.map((k) => (
              <tr key={k.id}>
                <Td>{k.label}</Td>
                <Td>{k.unit ?? ""}</Td>
                <Td right>{k.minScaled != null && k.maxScaled != null ? `${formatScaled(k.minScaled, k.decimals)} to ${formatScaled(k.maxScaled, k.decimals)}` : "Any"}</Td>
                <Td right>{k.expectedPerDay ?? "Optional"}</Td>
                <Td>{statusChip(k.active)}</Td>
                <Td right>{canWrite && <EditLink label={`Edit ${k.label}`} onClick={() => open(k.id)} />}</Td>
              </tr>
            ))}
            {data.logKinds.length === 0 && (
              <tr>
                <Td className="text-muted">No reading kinds yet. Add only the ones the estate has agreed (OC-100).</Td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/* ---------- Page ---------- */

/** One tare for every estate: pre-filled on the Plucking form, read-only for supervisors. */
function Tare({ data, canWrite }: { data: ReferenceData; canWrite: boolean }) {
  const app = useApp();
  const qc = useQueryClient();
  const current = data.rules?.tareG ?? 0;
  const currentText = current ? formatKg(current) : "0";
  const [text, setText] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const shown = text ?? currentText;
  const parsed = (() => {
    try {
      return parseKg(normalizeKg(shown || "0"));
    } catch (e) {
      return e instanceof WeightError ? e.message : "Enter the weight in kilograms, for example 0.5";
    }
  })();
  const bad = typeof parsed === "string";
  return (
    <Card title="Tare (bag weight)">
      <p className="mb-3 max-w-2xl text-sm text-muted">
        The weight taken off every weigh-in, the same for all estates. It is filled in on the Plucking form; supervisors cannot change it, managers and owners can. A change applies to weigh-ins saved
        from now on. Earlier weigh-ins keep the tare they were saved with. It starts at 0.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Tare (kg)" htmlFor="tare-default" error={bad ? parsed : undefined}>
          <Input id="tare-default" inputMode="decimal" value={shown} disabled={!canWrite} onChange={(e) => /^\d{0,3}(\.\d{0,3})?$/.test(e.target.value) && setText(e.target.value)} />
        </Field>
        <Button
          disabled={!canWrite || bad || parsed === current}
          onClick={async () => {
            try {
              await api("/admin/settings/muster.tare.defaultGrams", { method: "PUT", body: { value: parsed } });
              setNote({ tone: "ok", text: `Saved. ${formatKg(parsed as number)} kg is taken off each weigh-in saved from now on.` });
              setText(null);
              await qc.invalidateQueries({ queryKey: ["reference-all"] });
              await app.reloadReference();
            } catch (e) {
              setNote({ tone: "bad", text: e instanceof ApiError ? e.message : "Could not reach the server." });
            }
          }}
        >
          Save
        </Button>
      </div>
      {note && (
        <div className="mt-3">
          <Notice tone={note.tone}>{note.text}</Notice>
        </div>
      )}
    </Card>
  );
}

export function Masters() {
  const app = useApp();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("fields");
  const seasonStart = useDashboards(true).list.find((d) => d.season.startDate)?.season.startDate ?? null;
  const [target, setTarget] = useState<Target>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [note, setNote] = useState<{ tone: "ok" | "warn" | "bad"; text: string } | null>(null);
  const q = useQuery({ queryKey: ["reference-all"], queryFn: () => api<ReferenceData>("/reference?inactive=1"), enabled: app.online });
  if (!app.online) return <Notice tone="warn">Masters need signal. Fields, workers and jobs are changed on the server.</Notice>;
  const data = q.data;
  const writeEstate = (estateId: string) => app.can("masters.write", estateId);
  const anyWrite = (data?.estates ?? []).some((e) => writeEstate(e.id));
  const jobsWrite = app.canAny("masters.write");
  const kindsWrite = app.canAny("dailylog.configure");
  const tabs: { id: Tab; label: string }[] = [
    { id: "fields", label: "Fields" },
    { id: "workers", label: "Workers" },
    { id: "varieties", label: "Varieties" },
    { id: "jobs", label: "Jobs" },
    { id: "logkinds", label: "Log kinds" },
    { id: "tare", label: "Tare" },
  ];
  const addLabel = { fields: "Add field", workers: "Add worker", varieties: "Add variety", jobs: "Add job", logkinds: "Add kind", tare: "" }[tab];
  const canAdd = tab === "tare" ? false : tab === "jobs" || tab === "varieties" ? jobsWrite : tab === "logkinds" ? kindsWrite : anyWrite;
  const pick: Pick = {
    sel,
    toggle: (id) => setSel((cur) => (cur.has(id) ? new Set([...cur].filter((x) => x !== id)) : new Set([...cur, id]))),
    toggleAll: (ids, on) => setSel((cur) => new Set(on ? [...cur, ...ids] : [...cur].filter((x) => !ids.includes(x)))),
  };
  /** Delete the ticked workers or fields. The server refuses any that have records and says to set them Inactive. */
  async function deleteSelected() {
    const kind = tab === "workers" ? "workers" : "fields";
    const ids = [...sel];
    const reason = window.prompt(
      `Delete ${ids.length} ${kind === "workers" ? "worker" : "field"}${ids.length === 1 ? "" : "s"}? This cannot be undone. Only entries with no attendance or weigh-in records can be deleted; the others are kept and should be set Inactive.\n\nWhy are you deleting them? (kept in the audit trail)`,
    );
    if (!reason || reason.trim().length < 3) return;
    let deleted = 0;
    const kept: string[] = [];
    for (const id of ids) {
      try {
        await api(`/${kind}/${id}/delete`, { body: { reason: reason.trim() } });
        deleted++;
      } catch (e) {
        const name = kind === "workers" ? data?.workers.find((w) => w.id === id)?.name : data?.fields.find((f) => f.id === id)?.name;
        kept.push(`${name ?? id}${e instanceof ApiError && e.code === "IN_USE" ? "" : ` (${msg(e)})`}`);
      }
    }
    setSel(new Set());
    setNote({
      tone: kept.length ? "warn" : "ok",
      text: `${deleted} deleted.${kept.length ? ` ${kept.length} kept because they have attendance or weigh-in records or could not be deleted: ${kept.join(", ")}. Set those to Inactive instead.` : ""}`,
    });
    done();
  }
  const done = () => {
    setTarget(null);
    void qc.invalidateQueries({ queryKey: ["reference-all"] });
    void app.reloadReference();
  };
  const defaultEstate = data?.estates.find((e) => e.id === app.estateId && writeEstate(e.id))?.id ?? data?.estates.find((e) => writeEstate(e.id))?.id ?? "";
  const estateName = (id: string | undefined) => data?.estates.find((e) => e.id === id)?.name ?? "";
  const editing = target?.id;
  const subtitle =
    target?.tab === "fields"
      ? editing
        ? "Edit field"
        : "New field"
      : target?.tab === "workers"
        ? editing
          ? "Edit worker"
          : "New worker"
        : target?.tab === "varieties"
          ? editing
            ? "Edit variety"
            : "New variety"
          : target?.tab === "jobs"
            ? editing
              ? "Edit job"
              : "New job"
            : editing
              ? "Edit kind"
              : "New kind";
  const drawerTitle = !target
    ? ""
    : target.tab === "workers"
      ? editing
        ? `${data?.workers.find((w) => w.id === editing)?.employeeCode ?? ""} ${data?.workers.find((w) => w.id === editing)?.name ?? ""}`
        : estateName(defaultEstate)
      : target.tab === "fields"
        ? editing
          ? `${data?.fields.find((f) => f.id === editing)?.code ?? ""} ${data?.fields.find((f) => f.id === editing)?.name ?? ""}`
          : estateName(defaultEstate)
        : target.tab === "varieties"
          ? (data?.varieties.find((x) => x.id === editing)?.name ?? "Variety")
          : target.tab === "jobs"
            ? (data?.jobTypes.find((j) => j.id === editing)?.name ?? "Job")
            : (data?.logKinds.find((k) => k.id === editing)?.label ?? "Daily log kind");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="lg:flex lg:flex-wrap lg:items-baseline lg:gap-x-4">
          <h1>Masters</h1>
          <p className="mt-1 lg:mt-0 max-w-xl text-sm text-muted">
            The lists that attendance, muster and reports pick from. Inactive entries stay in history but no longer appear in the daily register.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <fieldset className="inline-flex gap-0.5 rounded-xl border-0 bg-surface-2 p-[3px]">
            <legend className="sr-only">Master lists</legend>
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                aria-pressed={tab === t.id}
                onClick={() => {
                  setTab(t.id);
                  setSel(new Set());
                  setNote(null);
                }}
                className={`min-h-9 rounded-lg px-3 text-sm font-medium transition-colors ${tab === t.id ? "bg-surface text-ink shadow-[0_0_0_1px_var(--color-line)]" : "text-muted hover:text-ink"}`}
              >
                {t.label}
              </button>
            ))}
          </fieldset>
          {sel.size > 0 && (tab === "workers" || tab === "fields") && (
            <Button variant="danger" onClick={() => void deleteSelected()}>
              Delete selected ({sel.size})
            </Button>
          )}
          {canAdd && <Button onClick={() => setTarget({ tab })}>{addLabel}</Button>}
        </div>
      </div>

      {note && <Notice tone={note.tone}>{note.text}</Notice>}
      {!canAdd && tab !== "tare" && (
        <Notice tone="info">
          {tab === "logkinds"
            ? "You can view the log kinds. They are shared by every estate, so only an owner or an estate manager can add or change them."
            : tab === "jobs" || tab === "varieties"
              ? `You can view the ${tab === "jobs" ? "jobs" : "varieties"}. They are shared by every estate, so only an owner or an estate manager can add or change them.`
              : `You can view the ${tab}. Only an owner or an estate manager of this estate can add or change them.`}
        </Notice>
      )}
      {q.isLoading && <p>Loading…</p>}
      {q.error && <Notice tone="bad">Could not load the lists.</Notice>}
      {data && tab === "fields" && <Fields data={data} canWrite={writeEstate} open={(id) => setTarget({ tab, id })} pick={pick} season={{ start: seasonStart, to: app.date }} />}
      {data && tab === "workers" && <Workers data={data} canWrite={writeEstate} open={(id) => setTarget({ tab, id })} pick={pick} />}
      {data && tab === "varieties" && <Varieties data={data} canWrite={jobsWrite} open={(id) => setTarget({ tab, id })} />}
      {data && tab === "jobs" && <Jobs data={data} canWrite={jobsWrite} open={(id) => setTarget({ tab, id })} />}
      {data && tab === "tare" && <Tare data={data} canWrite={app.canAny("settings.configure")} />}
      {data && tab === "logkinds" && <Kinds data={data} canWrite={kindsWrite} open={(id) => setTarget({ tab, id })} />}

      {data && target && (
        <Drawer title={drawerTitle} subtitle={subtitle} onClose={() => setTarget(null)}>
          {target.tab === "workers" && <WorkerForm data={data} id={target.id} estateId={defaultEstate} done={done} />}
          {target.tab === "fields" && <FieldForm data={data} id={target.id} estateId={defaultEstate} done={done} />}
          {target.tab === "varieties" && <VarietyForm data={data} id={target.id} done={done} />}
          {target.tab === "jobs" && <JobForm data={data} id={target.id} done={done} />}
          {target.tab === "logkinds" && <KindForm data={data} id={target.id} done={done} />}
        </Drawer>
      )}
    </div>
  );
}
