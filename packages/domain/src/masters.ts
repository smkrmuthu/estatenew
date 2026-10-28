/** Master data import specs. Column names are lower snake case; order does not matter. */
import { looksLikeFormula, parseCsv } from "./csv";

export const CROPS = ["COFFEE", "PEPPER"] as const;
export type Crop = (typeof CROPS)[number];

/** Optional on a worker. Collected for display only; use in tasks or rates waits on OC-99. */
export const GENDERS = ["MALE", "FEMALE"] as const;
export type Gender = (typeof GENDERS)[number];

/** What a part of a field is used for. Plucking is offered only on BEARING parts. */
export const LAND_USES = ["BEARING", "YOUNG", "ROCK", "WATER", "EMPTY", "OTHER_CROP"] as const;
export type LandUse = (typeof LAND_USES)[number];

/** How a worker is employed (OC-109). Optional on a worker. */
export const EMPLOYMENT_TYPES = ["PERMANENT", "CASUAL", "CONTRACT", "NORTH_INDIAN"] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export const IMPORT_KINDS = ["estates", "fields", "varieties", "job_types", "workers"] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

const CODE = /^[A-Za-z0-9][A-Za-z0-9 ._\-/]{0,39}$/;

export interface RowError {
  row: number;
  column: string;
  message: string;
}

export interface ParsedImport<T> {
  kind: ImportKind;
  rows: { row: number; key: string; value: T }[];
  errors: RowError[];
}

export interface EstateRow {
  code: string;
  name: string;
}
export interface FieldRow {
  estateCode: string;
  code: string;
  name: string;
  /** Hundredths of an acre, or null when not given. */
  areaCentiAcres: number | null;
  crops: Crop[];
  varietyCodes: string[];
}
export interface VarietyRow {
  code: string;
  name: string;
  crop: Crop;
}
export interface JobTypeRow {
  code: string;
  name: string;
}
export interface WorkerRow {
  estateCode: string;
  employeeCode: string;
  name: string;
  /** undefined: the file has no employment_type column, so leave the worker as is. null: column present but blank. */
  employmentType?: EmploymentType | null;
  /** Where the worker comes from (village or state). undefined: no area column in the file, so leave it as is. */
  area?: string | null;
  gender?: Gender | null;
}

type RowOf<K extends ImportKind> = K extends "estates" ? EstateRow : K extends "fields" ? FieldRow : K extends "varieties" ? VarietyRow : K extends "job_types" ? JobTypeRow : WorkerRow;

const COLUMNS: Record<ImportKind, { required: string[]; optional: string[] }> = {
  estates: { required: ["code", "name"], optional: [] },
  fields: { required: ["estate_code", "code", "name"], optional: ["area_acres", "crops", "varieties"] },
  varieties: { required: ["code", "name", "crop"], optional: [] },
  job_types: { required: ["code", "name"], optional: [] },
  // Gender is deliberately not imported (OC-99 open; collect only for a confirmed need).
  workers: { required: ["estate_code", "employee_code", "name"], optional: ["employment_type", "area", "gender"] },
};

export function importTemplate(kind: ImportKind): string {
  const c = COLUMNS[kind];
  return `${[...c.required, ...c.optional].join(",")}\n`;
}

export function parseImport<K extends ImportKind>(kind: K, csvText: string): ParsedImport<RowOf<K>> {
  const table = parseCsv(csvText);
  const header = (table[0] ?? []).map((h) => h.trim().toLowerCase());
  const spec = COLUMNS[kind];
  const errors: RowError[] = [];
  for (const col of spec.required) if (!header.includes(col)) errors.push({ row: 1, column: col, message: "Column is missing" });
  for (const col of header) if (col && ![...spec.required, ...spec.optional].includes(col)) errors.push({ row: 1, column: col, message: "Unknown column" });
  if (errors.length) return { kind, rows: [], errors };

  const out: { row: number; key: string; value: RowOf<K> }[] = [];
  const seen = new Map<string, number>();
  table.slice(1).forEach((cells, idx) => {
    const rowNo = idx + 2;
    const get = (col: string) => (cells[header.indexOf(col)] ?? "").trim();
    const rowErrors: RowError[] = [];
    const err = (column: string, message: string) => rowErrors.push({ row: rowNo, column, message });
    for (const col of header) {
      const v = get(col);
      if (looksLikeFormula(v) && !(col === "area_acres" && /^\d/.test(v))) err(col, "Value cannot start with =, +, - or @");
      if (v.length > 120) err(col, "Value is longer than 120 characters");
    }
    const code = (col: string) => {
      const v = get(col);
      if (!v) err(col, "Required");
      else if (!CODE.test(v)) err(col, "Use letters, numbers, space, dot, dash, slash or underscore (up to 40)");
      return v;
    };
    const name = (col: string) => {
      const v = get(col);
      if (!v) err(col, "Required");
      return v;
    };
    let value: unknown;
    let key: string;
    switch (kind) {
      case "estates":
      case "job_types": {
        const r = { code: code("code"), name: name("name") };
        key = r.code.toUpperCase();
        value = r;
        break;
      }
      case "varieties": {
        const crop = get("crop").toUpperCase();
        if (!(CROPS as readonly string[]).includes(crop)) err("crop", "Use COFFEE or PEPPER");
        const r = { code: code("code"), name: name("name"), crop: crop as Crop };
        key = r.code.toUpperCase();
        value = r;
        break;
      }
      case "fields": {
        const area = get("area_acres");
        let areaCentiAcres: number | null = null;
        if (area) {
          const m = /^(\d{1,5})(?:\.(\d{1,2}))?$/.exec(area);
          if (!m) err("area_acres", "Use a number with up to 2 decimals, for example 10.75");
          else areaCentiAcres = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
        }
        const cropsRaw = get("crops");
        const crops = (cropsRaw ? cropsRaw.split(";") : ["COFFEE"]).map((c) => c.trim().toUpperCase()).filter(Boolean);
        if (crops.some((c) => !(CROPS as readonly string[]).includes(c))) err("crops", "Use COFFEE, PEPPER or COFFEE;PEPPER");
        const varietyCodes = get("varieties")
          .split(";")
          .map((v) => v.trim())
          .filter(Boolean);
        const r = { estateCode: code("estate_code"), code: code("code"), name: name("name"), areaCentiAcres, crops: [...new Set(crops)] as Crop[], varietyCodes };
        key = `${r.estateCode.toUpperCase()}/${r.code.toUpperCase()}`;
        value = r;
        break;
      }
      case "workers": {
        const r: WorkerRow = { estateCode: code("estate_code"), employeeCode: code("employee_code"), name: name("name") };
        if (header.includes("employment_type")) {
          const t = get("employment_type").toUpperCase().replace(/\s+/g, "_");
          if (t && !(EMPLOYMENT_TYPES as readonly string[]).includes(t)) err("employment_type", "Use PERMANENT, CASUAL, CONTRACT or NORTH_INDIAN");
          r.employmentType = (t || null) as EmploymentType | null;
        }
        if (header.includes("area")) r.area = get("area") || null;
        if (header.includes("gender")) {
          const g = get("gender").toUpperCase();
          const full = g === "M" ? "MALE" : g === "F" ? "FEMALE" : g;
          if (full && !(GENDERS as readonly string[]).includes(full)) err("gender", "Use MALE or FEMALE");
          r.gender = (full || null) as Gender | null;
        }
        key = r.employeeCode.toUpperCase();
        value = r;
        break;
      }
    }
    const prev = seen.get(key);
    if (prev !== undefined) err(kind === "workers" ? "employee_code" : "code", `Duplicate of row ${prev}`);
    else seen.set(key, rowNo);
    if (rowErrors.length) errors.push(...rowErrors);
    else out.push({ row: rowNo, key, value: value as RowOf<K> });
  });
  return { kind, rows: out, errors };
}
