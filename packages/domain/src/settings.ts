/**
 * Tenant settings with configuration gates (ADR-0008).
 * While a setting's gate is open, production accepts only the safe interim default.
 */

import { isBusinessDate } from "./dates";

export type Environment = "development" | "test" | "staging" | "production";
export type SettingBasis = "confirmed" | "proposed" | "tenant-choice";

type Validator<T> = (value: unknown) => value is T;

export interface SettingDef<T = unknown> {
  key: string;
  description: string;
  /** Safe interim value used until the gate is confirmed. */
  defaultValue: T;
  basis: SettingBasis;
  /** Register item(s) that must be confirmed before a non-default value is allowed in production. */
  gates: readonly string[];
  validate: Validator<T>;
}

const isBool: Validator<boolean> = (v): v is boolean => typeof v === "boolean";
const oneOf =
  <T extends string>(...values: T[]): Validator<T> =>
  (v): v is T =>
    typeof v === "string" && (values as string[]).includes(v);
const intIn =
  (min: number, max: number): Validator<number> =>
  (v): v is number =>
    Number.isSafeInteger(v) && (v as number) >= min && (v as number) <= max;
const stringList =
  (allowed: readonly string[]): Validator<string[]> =>
  (v): v is string[] =>
    Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "string" && allowed.includes(x)) && new Set(v).size === v.length;
const nullableIntIn =
  (min: number, max: number): Validator<number | null> =>
  (v): v is number | null =>
    v === null || intIn(min, max)(v);
const shortText: Validator<string> = (v): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= 40;
const dateOrEmpty: Validator<string> = (v): v is string => v === "" || (typeof v === "string" && isBusinessDate(v));
const timeZone: Validator<string> = (v): v is string => {
  if (typeof v !== "string") return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: v });
    return true;
  } catch {
    return false;
  }
};

export const SETTING_DEFS = {
  "attendance.approval.required": {
    key: "attendance.approval.required",
    description: "Submitted attendance must be approved by a user holding attendance.approve.",
    defaultValue: true,
    basis: "proposed",
    gates: ["OC-7"],
    validate: isBool,
  },
  "attendance.statuses.enabled": {
    key: "attendance.statuses.enabled",
    description: "Attendance types in use.",
    defaultValue: ["PRESENT", "ABSENT"],
    basis: "confirmed",
    gates: ["OC-8"],
    validate: stringList(["PRESENT", "ABSENT", "LEAVE", "OFF_DAY", "HOLIDAY"]),
  },
  "attendance.backEntryDays": {
    key: "attendance.backEntryDays",
    description: "How many past days a supervisor may still capture without a correction.",
    defaultValue: 0,
    basis: "proposed",
    gates: ["OC-86"],
    validate: intIn(0, 31),
  },
  "attendance.duplicatePolicy": {
    key: "attendance.duplicatePolicy",
    description: "What happens when two devices record the same worker and day.",
    defaultValue: "CONFLICT",
    basis: "proposed",
    gates: ["OC-103"],
    validate: oneOf("CONFLICT"),
  },
  "muster.unit": {
    key: "muster.unit",
    description: "Unit for weigh-ins.",
    defaultValue: "KG",
    basis: "proposed",
    gates: ["OC-18"],
    validate: oneOf("KG"),
  },
  "muster.tare.mode": {
    key: "muster.tare.mode",
    description: "How tare is found: entered by hand, none, or bags times a configured empty-bag weight.",
    defaultValue: "MANUAL",
    basis: "proposed",
    gates: ["OC-19", "OC-87"],
    validate: oneOf("MANUAL", "NONE", "PER_BAG"),
  },
  "muster.tare.perBagGrams": {
    key: "muster.tare.perBagGrams",
    description: "Empty-bag weight in grams for PER_BAG tare. The prototype's 500 g is not confirmed.",
    defaultValue: null,
    basis: "proposed",
    gates: ["OC-87"],
    validate: nullableIntIn(0, 5000),
  },
  "muster.multiplePerDay": {
    key: "muster.multiplePerDay",
    description: "Several weigh-ins for one worker and day are kept and flagged.",
    defaultValue: "ALLOW_AND_FLAG",
    basis: "proposed",
    gates: ["OC-17"],
    validate: oneOf("ALLOW_AND_FLAG"),
  },
  "muster.variety.required": {
    key: "muster.variety.required",
    description: "A variety must be chosen on each weigh-in.",
    defaultValue: false,
    basis: "proposed",
    gates: ["OC-13", "OC-14"],
    validate: isBool,
  },
  "muster.quality.capture": {
    key: "muster.quality.capture",
    description: "Cherry quality is noted at weighing.",
    defaultValue: false,
    basis: "proposed",
    gates: ["OC-21"],
    validate: isBool,
  },
  "auth.offlineSessionHours": {
    key: "auth.offlineSessionHours",
    description: "Absolute session length, which bounds offline capture on a phone.",
    defaultValue: 12,
    basis: "proposed",
    gates: ["OC-101"],
    validate: intIn(1, 168),
  },
  "crops.enabled": {
    key: "crops.enabled",
    description: "Crops captured at weigh-in.",
    defaultValue: ["COFFEE", "PEPPER"],
    basis: "confirmed",
    gates: [],
    validate: stringList(["COFFEE", "PEPPER"]),
  },
  locale: {
    key: "locale",
    description: "Language of the application.",
    defaultValue: "en",
    basis: "proposed",
    gates: ["OC-64"],
    validate: oneOf("en"),
  },
  "terminology.field": {
    key: "terminology.field",
    description: "What the estate calls a field (for example Division).",
    defaultValue: "Field",
    basis: "tenant-choice",
    gates: [],
    validate: shortText,
  },
  "season.startDate": {
    key: "season.startDate",
    description: "First day of the plucking season, as a date like 2026-10-01. Season totals start from here; blank means no season totals.",
    defaultValue: "",
    basis: "proposed",
    gates: ["OC-75"],
    validate: dateOrEmpty,
  },
  "estate.timeZone": {
    key: "estate.timeZone",
    description: "Time zone that decides the business date.",
    defaultValue: "Asia/Kolkata",
    basis: "tenant-choice",
    gates: [],
    validate: timeZone,
  },
} as const satisfies Record<string, SettingDef>;

export type SettingKey = keyof typeof SETTING_DEFS;
export type SettingValue<K extends SettingKey> = (typeof SETTING_DEFS)[K]["defaultValue"] extends infer D
  ? D extends readonly string[]
    ? string[]
    : D extends boolean
      ? boolean
      : D extends number
        ? number
        : D extends null
          ? number | null
          : string
  : never;

export function isSettingKey(key: string): key is SettingKey {
  return Object.hasOwn(SETTING_DEFS, key);
}

export type GateStatus = "confirmed" | "open" | "answered-unclear";

export class SettingError extends Error {
  constructor(
    readonly code: "SETTING_UNKNOWN" | "SETTING_INVALID" | "GATE_NOT_CONFIRMED",
    message: string,
    readonly gates: readonly string[] = [],
  ) {
    super(message);
  }
}

/**
 * Check a proposed change. In production, while any gate is open, only the interim
 * default is accepted (for list settings: a subset of the default, never additions).
 */
export function checkSettingChange(key: string, value: unknown, env: Environment, gateStatus: (id: string) => GateStatus): void {
  if (!isSettingKey(key)) throw new SettingError("SETTING_UNKNOWN", `Unknown setting ${key}`);
  const def: SettingDef = SETTING_DEFS[key];
  if (!def.validate(value)) throw new SettingError("SETTING_INVALID", `Value not allowed for ${key}`);
  const open = def.gates.filter((g) => gateStatus(g) !== "confirmed");
  if (env !== "production" || open.length === 0) return;
  if (sameAsDefaultOrNarrower(def.defaultValue, value)) return;
  throw new SettingError("GATE_NOT_CONFIRMED", `This needs the owner's confirmation first (${open.join(", ")})`, open);
}

function sameAsDefaultOrNarrower(defaultValue: unknown, value: unknown): boolean {
  if (Array.isArray(defaultValue) && Array.isArray(value)) return value.every((v) => defaultValue.includes(v));
  return JSON.stringify(defaultValue) === JSON.stringify(value);
}

export function resolveSetting<K extends SettingKey>(key: K, stored: Readonly<Record<string, unknown>>): SettingValue<K> {
  const def: SettingDef = SETTING_DEFS[key];
  const raw = Object.hasOwn(stored, key) ? stored[key] : undefined;
  return (raw !== undefined && def.validate(raw) ? raw : def.defaultValue) as SettingValue<K>;
}
