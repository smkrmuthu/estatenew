import { describe, expect, it } from "vitest";
import {
  AttendanceRuleError,
  addDays,
  backoffMs,
  businessDateAt,
  can,
  canAnyEstate,
  canonicalJson,
  checkSettingChange,
  DEFAULT_ATTENDANCE_STATUSES,
  estatesWith,
  halfDays,
  isBusinessDate,
  isUuidV7,
  normalizeAttendanceRecord,
  parseMfaRoles,
  parseReading,
  requiresMfa,
  resolveSetting,
  SettingError,
  transitionSheet,
  uuidv7,
  uuidv7Time,
} from "../src";

describe("permissions", () => {
  const sup = [{ role: "FIELD_SUPERVISOR" as const, estateId: "E1" }];
  it("scopes supervisors to their estate", () => {
    expect(can(sup, "attendance.capture", "E1")).toBe(true);
    expect(can(sup, "attendance.capture", "E2")).toBe(false);
    expect(can(sup, "attendance.approve", "E1")).toBe(false);
    expect(can(sup, "users.manage", null)).toBe(false);
    expect(estatesWith(sup, "muster.capture")).toEqual(["E1"]);
  });
  it("owners are tenant-wide; estate managers change settings but not users or go-live answers", () => {
    expect(can([{ role: "OWNER", estateId: null }], "users.manage", null)).toBe(true);
    expect(can([{ role: "ESTATE_MANAGER", estateId: null }], "users.manage", null)).toBe(false);
    expect(can([{ role: "ESTATE_MANAGER", estateId: "E1" }], "users.manage", "E1")).toBe(false);
    expect(can([{ role: "ESTATE_MANAGER", estateId: null }], "settings.configure", null)).toBe(true);
    expect(can([{ role: "ESTATE_MANAGER", estateId: null }], "settings.manage", null)).toBe(false);
    expect(can([{ role: "ESTATE_MANAGER", estateId: "E1" }], "attendance.approve", "E1")).toBe(true);
  });
  it("lists every estate shares need the permission on any estate, not on all", () => {
    const two = [
      { role: "ESTATE_MANAGER", estateId: "E1" },
      { role: "ESTATE_MANAGER", estateId: "E2" },
    ] as const;
    expect(can(two, "dailylog.configure", null)).toBe(false);
    expect(canAnyEstate(two, "dailylog.configure")).toBe(true);
    expect(canAnyEstate(sup, "dailylog.configure")).toBe(false);
    expect(canAnyEstate([{ role: "OWNER", estateId: "E1" }], "settings.manage")).toBe(false);
    expect(canAnyEstate([{ role: "OWNER", estateId: null }], "settings.manage")).toBe(true);
  });
  it("an estate-scoped grant never gives tenant-wide permissions", () => {
    expect(can([{ role: "OWNER", estateId: "E1" }], "settings.manage", null)).toBe(false);
  });
  it("platform admins have no tenant data permissions", () => {
    expect(can([{ role: "PLATFORM_ADMIN", estateId: null }], "attendance.read", "E1")).toBe(false);
  });
  it("auditors read but never write", () => {
    const a = [{ role: "AUDITOR" as const, estateId: null }];
    expect(can(a, "audit.read", "E1")).toBe(true);
    expect(can(a, "attendance.capture", "E1")).toBe(false);
  });
  it("only owners need MFA by default; managers and supervisors do not", () => {
    expect(requiresMfa([{ role: "OWNER", estateId: null }])).toBe(true);
    expect(requiresMfa([{ role: "ESTATE_MANAGER", estateId: "E1" }])).toBe(false);
    expect(requiresMfa(sup)).toBe(false);
  });
  it("each environment chooses the enforced roles; empty means none", () => {
    expect([...parseMfaRoles("OWNER, platform_admin,nonsense")].sort()).toEqual(["OWNER", "PLATFORM_ADMIN"]);
    expect(requiresMfa([{ role: "OWNER", estateId: null }], parseMfaRoles(""))).toBe(false);
    expect(requiresMfa([{ role: "ESTATE_MANAGER", estateId: "E1" }], parseMfaRoles("ESTATE_MANAGER"))).toBe(true);
  });
});

describe("attendance", () => {
  const statuses = DEFAULT_ATTENDANCE_STATUSES;
  it("present needs day fraction, field and job", () => {
    expect(() => normalizeAttendanceRecord({ statusCode: "PRESENT" }, statuses)).toThrow(AttendanceRuleError);
    expect(normalizeAttendanceRecord({ statusCode: "PRESENT", dayFraction: "HALF", fieldId: "F", jobTypeId: "J" }, statuses)).toMatchObject({ presence: "PRESENT", dayFraction: "HALF" });
  });
  it("absent clears the assignment", () => {
    expect(normalizeAttendanceRecord({ statusCode: "ABSENT", dayFraction: "FULL", fieldId: "F", jobTypeId: "J" }, statuses)).toMatchObject({ fieldId: null, jobTypeId: null, dayFraction: null });
  });
  it("proposed statuses are inactive until confirmed", () => {
    expect(() => normalizeAttendanceRecord({ statusCode: "LEAVE" }, statuses)).toThrow(/not in use/);
  });
  it("sheet transitions", () => {
    expect(transitionSheet("DRAFT", "submit")).toBe("SUBMITTED");
    expect(transitionSheet("SUBMITTED", "approve")).toBe("APPROVED");
    expect(() => transitionSheet("SUBMITTED", "return")).toThrow(/reason/);
    expect(transitionSheet("SUBMITTED", "return", "Wrong field")).toBe("DRAFT");
    expect(() => transitionSheet("APPROVED", "submit")).toThrow(AttendanceRuleError);
  });
  it("counts half days as integers", () => {
    expect(halfDays({ presence: "PRESENT", dayFraction: "FULL" })).toBe(2);
    expect(halfDays({ presence: "PRESENT", dayFraction: "HALF" })).toBe(1);
    expect(halfDays({ presence: "ABSENT", dayFraction: null })).toBe(0);
  });
});

describe("settings gates", () => {
  const open = () => "open" as const;
  const confirmed = () => "confirmed" as const;
  it("production refuses unconfirmed values but allows the interim default", () => {
    expect(() => checkSettingChange("muster.tare.mode", "PER_BAG", "production", open)).toThrow(SettingError);
    expect(() => checkSettingChange("muster.tare.mode", "MANUAL", "production", open)).not.toThrow();
    expect(() => checkSettingChange("attendance.statuses.enabled", ["PRESENT", "ABSENT", "LEAVE"], "production", open)).toThrow(/confirmation/);
    expect(() => checkSettingChange("attendance.statuses.enabled", ["PRESENT"], "production", open)).not.toThrow();
  });
  it("staging may use proposed values; confirmed gates unlock production", () => {
    expect(() => checkSettingChange("muster.tare.mode", "PER_BAG", "staging", open)).not.toThrow();
    expect(() => checkSettingChange("muster.tare.mode", "PER_BAG", "production", confirmed)).not.toThrow();
  });
  it("validates and rejects unknown keys", () => {
    expect(() => checkSettingChange("nope", 1, "staging", open)).toThrow(/Unknown/);
    expect(() => checkSettingChange("auth.offlineSessionHours", 500, "staging", open)).toThrow(/not allowed/);
    expect(() => checkSettingChange("estate.timeZone", "Mars/Base", "staging", open)).toThrow(/not allowed/);
  });
  it("resolves stored values and falls back to defaults", () => {
    expect(resolveSetting("auth.offlineSessionHours", {})).toBe(12);
    expect(resolveSetting("auth.offlineSessionHours", { "auth.offlineSessionHours": 24 })).toBe(24);
    expect(resolveSetting("auth.offlineSessionHours", { "auth.offlineSessionHours": "x" })).toBe(12);
  });
});

describe("daily log readings", () => {
  const temp = { code: "T", label: "Temperature", unit: "°C", valueType: "NUMBER" as const, decimals: 1, minScaled: -100, maxScaled: 600 };
  it("scales decimals exactly and checks the range", () => {
    expect(parseReading(temp, "24.5")).toEqual({ valueScaled: 245, valueText: null });
    expect(parseReading(temp, "-3")).toEqual({ valueScaled: -30, valueText: null });
    expect(() => parseReading(temp, "24.55")).toThrow(/decimal/);
    expect(() => parseReading(temp, "61")).toThrow(/between/);
  });
  it("text readings", () => {
    const t = { ...temp, valueType: "TEXT" as const };
    expect(parseReading(t, " cloudy ")).toEqual({ valueScaled: null, valueText: "cloudy" });
  });
});

describe("ids, dates, sync helpers", () => {
  it("uuidv7 is valid and time ordered", () => {
    const a = uuidv7(1_700_000_000_000);
    const b = uuidv7(1_700_000_000_001);
    expect(isUuidV7(a)).toBe(true);
    expect(uuidv7Time(a)).toBe(1_700_000_000_000);
    expect(a < b).toBe(true);
  });
  it("business dates follow the estate time zone", () => {
    expect(businessDateAt(new Date("2026-10-31T19:00:00Z"), "Asia/Kolkata")).toBe("2026-11-01");
    expect(isBusinessDate("2026-02-30")).toBe(false);
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
  });
  it("backoff has jitter and a cap", () => {
    expect(backoffMs(0, () => 0.5)).toBe(1000);
    expect(backoffMs(20, () => 0.999)).toBeLessThan(300_000);
  });
  it("canonical json sorts keys", () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe('{"a":[2,{"c":2,"d":1}],"b":1}');
  });
});
