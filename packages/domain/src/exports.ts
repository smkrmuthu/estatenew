/**
 * Excel exports of attendance and plucking. These functions only turn already-loaded rows into sheet
 * models (cells, merges, widths); writing the .xlsx file happens in the API.
 *
 * "Old format" copies the estate's paper-style daily sheet (one sheet per date, attendance on the left,
 * plucking on the right). "New format" is the app's own layout: flat tables that can be filtered and kept as a backup.
 */

export type CellStyle = "title" | "label" | "labelCenter" | "text" | "center" | "number" | "head" | "body" | "bodyNumber" | "bold";
export type Cell = string | number | null | { v: string | number | null; s: CellStyle };

export interface SheetModel {
  name: string;
  /** Which look to give the sheet: the old estate sheet (grey bands, narrow font) or the app's own tables. */
  look: "old" | "new";
  rows: Cell[][];
  /** Merged ranges in A1 notation, for example "A1:O1". */
  merges?: string[];
  /** Column widths in characters. */
  widths: number[];
  /** Rows kept visible while scrolling. */
  frozenRows?: number;
}

export interface ExportWorker {
  id: string;
  employeeCode: string;
  name: string;
  gender: "MALE" | "FEMALE" | null;
  employmentType: "PERMANENT" | "CASUAL" | "CONTRACT" | "NORTH_INDIAN" | null;
  area: string | null;
  active: boolean;
}
export interface ExportRecord {
  businessDate: string;
  shift: "DAY" | "NIGHT";
  workerId: string;
  statusCode: string;
  presence: string;
  dayFraction: "FULL" | "HALF" | null;
  fieldId: string | null;
  jobTypeId: string | null;
  remarks: string | null;
}
export interface ExportEntry {
  businessDate: string;
  workerId: string;
  fieldId: string;
  varietyId: string | null;
  crop: "COFFEE" | "PEPPER";
  grossG: number;
  bags: number;
  tareG: number;
  netG: number;
  remarks: string | null;
}
export interface ExportData {
  estate: { id: string; code: string; name: string };
  from: string;
  to: string;
  /** When the file was made (ISO), shown in the backup file. */
  exportedAt: string;
  workers: ExportWorker[];
  fields: { id: string; name: string }[];
  jobTypes: { id: string; name: string }[];
  varieties: { id: string; name: string }[];
  records: ExportRecord[];
  entries: ExportEntry[];
}

const TYPE_LABEL: Record<NonNullable<ExportWorker["employmentType"]>, string> = { PERMANENT: "Permanent", CASUAL: "Casual", CONTRACT: "Contract", NORTH_INDIAN: "North Indian" };
const STATUS_LABEL: Record<string, string> = { PRESENT: "Present", ABSENT: "Absent", LEAVE: "Leave", OFF_DAY: "Off day", HOLIDAY: "Holiday" };
const DASH = "-";
const kg = (g: number) => g / 1000;
const dotted = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;
const dashed = (d: string) => `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}`;
const orDash = (s: string | null | undefined) => (s?.trim() ? s : DASH);

const genderLabel = (g: ExportWorker["gender"]) => (g === "MALE" ? "Male" : g === "FEMALE" ? "Female" : DASH);
const typeLabel = (t: ExportWorker["employmentType"]) => (t ? TYPE_LABEL[t] : DASH);
const statusLabel = (r: Pick<ExportRecord, "statusCode" | "presence" | "dayFraction">) =>
  r.presence === "PRESENT" && r.dayFraction === "HALF" ? "Half day" : (STATUS_LABEL[r.statusCode] ?? r.statusCode.replace(/_/g, " ").toLowerCase());

const byCode = (a: ExportWorker, b: ExportWorker) => a.employeeCode.localeCompare(b.employeeCode, "en", { numeric: true });

/** Every date in the range that has an attendance record or a weigh-in, oldest first. */
export function exportDates(data: Pick<ExportData, "records" | "entries">): string[] {
  return [...new Set([...data.records.map((r) => r.businessDate), ...data.entries.map((e) => e.businessDate)])].sort();
}

/** The old estate sheet's columns, in its order. */
export const OLD_FORMAT_COLUMNS = [
  "Worker",
  "Gender",
  "Area",
  "Worker Status",
  "Status",
  "Field",
  "Job",
  "Remarks",
  "Field",
  "Variety",
  "Gross(Kgs)",
  "Bags",
  "Bag Wt",
  "Nett (Kgs)",
  "Remarks",
] as const;
const OLD_WIDTHS = [19, 19, 19, 19, 9, 14.5, 24.7, 9, 14.5, 12.5, 10.7, 9, 9, 9.6, 17.9];
export const OLD_FORMAT_TITLE = "COFFEE ESTATE MANGAMENT SYSTEM";

interface PluckGroup {
  fieldId: string;
  varietyId: string | null;
  grossG: number;
  bags: number;
  tareG: number;
  netG: number;
  remarks: string[];
}

/** One worker's weigh-ins for a day, grouped by field and variety (one row of the old sheet each). */
function pluckGroups(entries: ExportEntry[]): PluckGroup[] {
  const m = new Map<string, PluckGroup>();
  for (const e of entries) {
    const key = `${e.fieldId}|${e.varietyId ?? ""}`;
    const g = m.get(key) ?? { fieldId: e.fieldId, varietyId: e.varietyId, grossG: 0, bags: 0, tareG: 0, netG: 0, remarks: [] };
    g.grossG += e.grossG;
    g.bags += e.bags;
    g.tareG += e.tareG;
    g.netG += e.netG;
    if (e.remarks) g.remarks.push(e.remarks);
    m.set(key, g);
  }
  return [...m.values()];
}

/** One sheet per date, in the layout of the estate's old daily sheet. */
export function oldFormatSheets(data: ExportData, withEstateInName = false): SheetModel[] {
  const fieldName = new Map(data.fields.map((f) => [f.id, f.name]));
  const jobName = new Map(data.jobTypes.map((j) => [j.id, j.name]));
  const varietyName = new Map(data.varieties.map((v) => [v.id, v.name]));
  const workers = [...data.workers].sort(byCode);

  return exportDates(data).map((date) => {
    const recs = data.records.filter((r) => r.businessDate === date);
    const entries = data.entries.filter((e) => e.businessDate === date);
    const body: Cell[][] = [];
    const cell = (v: string | number, s: CellStyle = "text"): Cell => ({ v, s });
    const plucking = (g: PluckGroup | undefined, fallbackField: string): Cell[] => {
      if (!g) return [cell(fallbackField), cell(DASH), cell(DASH), cell(DASH), cell(DASH), cell(DASH), cell(DASH)];
      return [
        cell(fieldName.get(g.fieldId) ?? DASH),
        cell(g.varietyId ? (varietyName.get(g.varietyId) ?? DASH) : DASH),
        cell(kg(g.grossG), "number"),
        cell(g.bags),
        g.bags > 0 && g.tareG > 0 ? cell(kg(Math.round(g.tareG / g.bags)), "number") : cell(DASH),
        cell(kg(g.netG), "number"),
        cell(g.remarks.length ? g.remarks.join("; ") : DASH),
      ];
    };

    for (const w of workers) {
      const mine = recs.filter((r) => r.workerId === w.id).sort((a, b) => (a.shift === b.shift ? 0 : a.shift === "DAY" ? -1 : 1));
      const groups = pluckGroups(entries.filter((e) => e.workerId === w.id));
      if (mine.length === 0 && groups.length === 0 && !w.active) continue;
      const who = (): Cell[] => [cell(w.name), cell(genderLabel(w.gender)), cell(orDash(w.area)), cell(typeLabel(w.employmentType))];
      if (mine.length === 0) {
        // Not marked on the register: shown, so nobody is silently missing from the day.
        body.push([...who(), cell("Not marked"), cell(DASH), cell(DASH), cell(DASH), ...plucking(groups[0], DASH)]);
      }
      mine.forEach((r, i) => {
        const field = r.fieldId ? (fieldName.get(r.fieldId) ?? DASH) : DASH;
        const remark = [r.shift === "NIGHT" ? "Night shift" : null, r.remarks].filter(Boolean).join("; ");
        body.push([
          ...who(),
          cell(statusLabel(r)),
          cell(field),
          cell(r.jobTypeId ? (jobName.get(r.jobTypeId) ?? DASH) : DASH),
          cell(orDash(remark)),
          ...plucking(i === 0 ? groups[0] : undefined, r.presence === "PRESENT" ? field : DASH),
        ]);
      });
      // More than one field or variety on the day: the extra weigh-ins follow on their own rows.
      for (const g of groups.slice(1)) body.push([...who(), cell(DASH), cell(DASH), cell(DASH), cell(DASH), ...plucking(g, DASH)]);
    }

    const title: Cell[] = [{ v: `${OLD_FORMAT_TITLE} - OLD FORMAT`, s: "title" }, ...Array.from({ length: 14 }, () => ({ v: null, s: "title" as const }))];
    const info: Cell[] = Array.from({ length: 15 }, () => ({ v: null as string | number | null, s: "label" as const }));
    info[0] = { v: "Estate", s: "label" };
    info[4] = { v: data.estate.name, s: "labelCenter" };
    info[13] = { v: "Date", s: "label" };
    info[14] = { v: dotted(date), s: "label" };
    const band: Cell[] = Array.from({ length: 15 }, () => ({ v: null as string | number | null, s: "title" as const }));
    band[0] = { v: "Attendance", s: "title" };
    band[8] = { v: "Plucking", s: "title" };
    const head: Cell[] = OLD_FORMAT_COLUMNS.map((h) => ({ v: h, s: "center" as const }));

    return {
      name: withEstateInName ? `${dashed(date)} ${data.estate.code}` : dashed(date),
      look: "old" as const,
      rows: [title, info, band, head, ...body],
      merges: ["A1:O1", "E2:F2", "A3:H3", "I3:O3"],
      widths: OLD_WIDTHS,
    };
  });
}

/** The app's own layout: About, Summary by day, Attendance and Plucking tables. */
export function newFormatSheets(data: ExportData): SheetModel[] {
  const fieldName = new Map(data.fields.map((f) => [f.id, f.name]));
  const jobName = new Map(data.jobTypes.map((j) => [j.id, j.name]));
  const varietyName = new Map(data.varieties.map((v) => [v.id, v.name]));
  const worker = new Map(data.workers.map((w) => [w.id, w]));
  const h = (...labels: string[]): Cell[] => labels.map((v) => ({ v, s: "head" as const }));
  const b = (...vals: (string | number | null)[]): Cell[] => vals.map((v) => ({ v, s: typeof v === "number" ? ("bodyNumber" as const) : ("body" as const) }));
  const dates = exportDates(data);

  const about: Cell[][] = [
    [{ v: "CEMMS export (new format)", s: "bold" }],
    [{ v: "Estate", s: "bold" }, `${data.estate.name} (${data.estate.code})`],
    [{ v: "From", s: "bold" }, data.from],
    [{ v: "To", s: "bold" }, data.to],
    [{ v: "Made at", s: "bold" }, data.exportedAt],
    [{ v: "Basis", s: "bold" }, "Only entries the server has received. Entries still waiting on a phone are not included."],
    [{ v: "Sheets", s: "bold" }, "Summary by day, Attendance (one row per worker per shift), Plucking (one row per weigh-in)."],
  ];

  const summary: Cell[][] = [h("Date", "Present", "Half day", "Absent or leave", "Off or holiday", "Weigh-ins", "Coffee net (kg)", "Pepper net (kg)")];
  for (const d of dates) {
    const r = data.records.filter((x) => x.businessDate === d && x.shift === "DAY");
    const e = data.entries.filter((x) => x.businessDate === d);
    summary.push(
      b(
        d,
        r.filter((x) => x.presence === "PRESENT" && x.dayFraction !== "HALF").length,
        r.filter((x) => x.presence === "PRESENT" && x.dayFraction === "HALF").length,
        r.filter((x) => x.presence === "ABSENT" || x.presence === "LEAVE").length,
        r.filter((x) => x.presence === "OFF").length,
        e.length,
        kg(e.filter((x) => x.crop === "COFFEE").reduce((s, x) => s + x.netG, 0)),
        kg(e.filter((x) => x.crop === "PEPPER").reduce((s, x) => s + x.netG, 0)),
      ),
    );
  }

  const attendance: Cell[][] = [h("Date", "Shift", "Code", "Worker", "Gender", "Area", "Worker type", "Status", "Field", "Job", "Remarks")];
  for (const r of [...data.records].sort(
    (a, c) =>
      a.businessDate.localeCompare(c.businessDate) ||
      (worker.get(a.workerId)?.employeeCode ?? "").localeCompare(worker.get(c.workerId)?.employeeCode ?? "", "en", { numeric: true }) ||
      a.shift.localeCompare(c.shift),
  )) {
    const w = worker.get(r.workerId);
    attendance.push(
      b(
        r.businessDate,
        r.shift === "NIGHT" ? "Night" : "Day",
        w?.employeeCode ?? "?",
        w?.name ?? "?",
        genderLabel(w?.gender ?? null),
        orDash(w?.area),
        typeLabel(w?.employmentType ?? null),
        statusLabel(r),
        r.fieldId ? (fieldName.get(r.fieldId) ?? "?") : "",
        r.jobTypeId ? (jobName.get(r.jobTypeId) ?? "?") : "",
        r.remarks ?? "",
      ),
    );
  }

  const plucking: Cell[][] = [h("Date", "Code", "Worker", "Crop", "Field", "Variety", "Gross (kg)", "Bags", "Tare (kg)", "Net (kg)", "Remarks")];
  for (const e of [...data.entries].sort(
    (a, c) => a.businessDate.localeCompare(c.businessDate) || (worker.get(a.workerId)?.employeeCode ?? "").localeCompare(worker.get(c.workerId)?.employeeCode ?? "", "en", { numeric: true }),
  )) {
    const w = worker.get(e.workerId);
    plucking.push(
      b(
        e.businessDate,
        w?.employeeCode ?? "?",
        w?.name ?? "?",
        e.crop === "COFFEE" ? "Coffee" : "Pepper",
        fieldName.get(e.fieldId) ?? "?",
        e.varietyId ? (varietyName.get(e.varietyId) ?? "?") : "",
        kg(e.grossG),
        e.bags,
        kg(e.tareG),
        kg(e.netG),
        e.remarks ?? "",
      ),
    );
  }

  return [
    { name: "About", look: "new", rows: about, widths: [14, 90] },
    { name: "Summary by day", look: "new", rows: summary, widths: [12, 10, 10, 16, 14, 11, 16, 16], frozenRows: 1 },
    { name: "Attendance", look: "new", rows: attendance, widths: [12, 8, 10, 24, 9, 16, 14, 11, 18, 24, 24], frozenRows: 1 },
    { name: "Plucking", look: "new", rows: plucking, widths: [12, 10, 24, 9, 18, 16, 11, 7, 10, 10, 24], frozenRows: 1 },
  ];
}

/** Old-format sheets for several estates in one file: each date gets a sheet per estate, named like "26-10-2026 GLZ". */
export function oldFormatSheetsFor(all: ExportData[]): SheetModel[] {
  if (all.length === 1 && all[0]) return oldFormatSheets(all[0]);
  const order = new Map(all.map((d, i) => [d.estate.code, i]));
  return all
    .flatMap((d) => oldFormatSheets(d, true))
    .sort((a, b) => {
      const key = (n: string) => `${n.slice(6, 10)}${n.slice(3, 5)}${n.slice(0, 2)}`;
      return key(a.name).localeCompare(key(b.name)) || (order.get(a.name.slice(11)) ?? 0) - (order.get(b.name.slice(11)) ?? 0);
    });
}

/** New-format workbook for several estates: the same tables with an Estate column in front. */
export function newFormatSheetsFor(all: ExportData[]): SheetModel[] {
  if (all.length === 1 && all[0]) return newFormatSheets(all[0]);
  const first = all[0];
  if (!first) return [];
  const per = all.map((d) => ({ d, sheets: newFormatSheets(d) }));
  const merged = (name: string): SheetModel => {
    const model = per[0]?.sheets.find((x) => x.name === name) as SheetModel;
    const rows: Cell[][] = [[{ v: "Estate", s: "head" as const }, ...(model.rows[0] ?? [])]];
    for (const { d, sheets } of per) {
      const sheet = sheets.find((x) => x.name === name);
      for (const row of (sheet?.rows ?? []).slice(1)) rows.push([{ v: d.estate.code, s: "body" as const }, ...row]);
    }
    return { ...model, rows, widths: [8, ...model.widths] };
  };
  const about: Cell[][] = [
    [{ v: "CEMMS export (new format)", s: "bold" }],
    [{ v: "Estates", s: "bold" }, all.map((d) => `${d.estate.name} (${d.estate.code})`).join(", ")],
    [{ v: "From", s: "bold" }, first.from],
    [{ v: "To", s: "bold" }, first.to],
    [{ v: "Made at", s: "bold" }, first.exportedAt],
    [{ v: "Basis", s: "bold" }, "Only entries the server has received. Entries still waiting on a phone are not included."],
    [{ v: "Sheets", s: "bold" }, "Summary by day, Attendance (one row per worker per shift) and Plucking (one row per weigh-in), each with an Estate column."],
  ];
  return [{ name: "About", look: "new", rows: about, widths: [14, 90] }, merged("Summary by day"), merged("Attendance"), merged("Plucking")];
}
