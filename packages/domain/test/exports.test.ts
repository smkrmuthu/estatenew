import { describe, expect, it } from "vitest";
import { type ExportData, newFormatSheets, newFormatSheetsFor, OLD_FORMAT_COLUMNS, oldFormatSheets, oldFormatSheetsFor } from "../src/exports";

const data: ExportData = {
  estate: { id: "e1", code: "GLZ", name: "Glazebrooke" },
  from: "2026-10-26",
  to: "2026-10-27",
  exportedAt: "2026-10-28T10:00:00.000Z",
  workers: [
    { id: "w2", employeeCode: "GLZ010", name: "Kanagavalli", gender: "FEMALE", employmentType: "PERMANENT", area: "Keeraikadu", active: true },
    { id: "w1", employeeCode: "GLZ002", name: "Sanjay", gender: "MALE", employmentType: "NORTH_INDIAN", area: null, active: true },
    { id: "w3", employeeCode: "GLZ003", name: "Left Estate", gender: null, employmentType: null, area: null, active: false },
  ],
  fields: [{ id: "f1", name: "Devandran Kadu" }],
  jobTypes: [
    { id: "j1", name: "Coffee Fruit Picking" },
    { id: "j2", name: "Night Watcher" },
  ],
  varieties: [{ id: "v1", name: "Chandana Giri" }],
  records: [
    { businessDate: "2026-10-26", shift: "DAY", workerId: "w1", statusCode: "PRESENT", presence: "PRESENT", dayFraction: "HALF", fieldId: "f1", jobTypeId: "j1", remarks: null },
    { businessDate: "2026-10-26", shift: "NIGHT", workerId: "w1", statusCode: "PRESENT", presence: "PRESENT", dayFraction: "FULL", fieldId: "f1", jobTypeId: "j2", remarks: null },
    { businessDate: "2026-10-27", shift: "DAY", workerId: "w2", statusCode: "ABSENT", presence: "ABSENT", dayFraction: null, fieldId: null, jobTypeId: null, remarks: "Fever" },
  ],
  entries: [
    { businessDate: "2026-10-26", workerId: "w1", fieldId: "f1", varietyId: "v1", crop: "COFFEE", grossG: 20500, bags: 2, tareG: 1000, netG: 19500, remarks: null },
    { businessDate: "2026-10-26", workerId: "w1", fieldId: "f1", varietyId: "v1", crop: "COFFEE", grossG: 10000, bags: 1, tareG: 500, netG: 9500, remarks: null },
  ],
};
const v = (c: unknown) => (c !== null && typeof c === "object" ? (c as { v: unknown }).v : c);
const grid = (rows: unknown[][]) => rows.map((r) => r.map(v));

describe("old format", () => {
  it("makes one sheet per date with the estate sheet's header rows and columns", () => {
    const sheets = oldFormatSheets(data);
    expect(sheets.map((s) => s.name)).toEqual(["26-10-2026", "27-10-2026"]);
    const first = grid(sheets[0]?.rows ?? []);
    expect(first[0]?.[0]).toBe("COFFEE ESTATE MANGAMENT SYSTEM - OLD FORMAT");
    expect(first[1]).toEqual(expect.arrayContaining(["Estate", "Glazebrooke", "Date", "26.10.2026"]));
    expect(first[2]?.[0]).toBe("Attendance");
    expect(first[2]?.[8]).toBe("Plucking");
    expect(first[3]).toEqual([...OLD_FORMAT_COLUMNS]);
    expect(sheets[0]?.merges).toEqual(["A1:O1", "E2:F2", "A3:H3", "I3:O3"]);
    expect(sheets[0]?.widths).toHaveLength(15);
  });

  it("lists workers by code, shows both shifts, merges weigh-ins of a field and variety, and keeps unmarked workers visible", () => {
    const rows = grid(oldFormatSheets(data)[0]?.rows ?? []).slice(4);
    // Sanjay (GLZ002) first: Day half day with plucking, then the night row. Then Kanagavalli (GLZ010) not marked. The inactive worker with nothing is left out.
    expect(rows.map((r) => [r[0], r[4], r[6]])).toEqual([
      ["Sanjay", "Half day", "Coffee Fruit Picking"],
      ["Sanjay", "Present", "Night Watcher"],
      ["Kanagavalli", "Not marked", "-"],
    ]);
    expect(rows[0]?.slice(8)).toEqual(["Devandran Kadu", "Chandana Giri", 30.5, 3, 0.5, 29, "-"]);
    expect(rows[1]?.[7]).toBe("Night shift");
    expect(rows[1]?.slice(8, 10)).toEqual(["Devandran Kadu", "-"]);
    expect(rows[0]?.[2]).toBe("-");
  });

  it("shows absence and remarks", () => {
    const rows = grid(oldFormatSheets(data)[1]?.rows ?? []).slice(4);
    expect(rows.find((r) => r[0] === "Kanagavalli")?.slice(4, 8)).toEqual(["Absent", "-", "-", "Fever"]);
  });

  it("makes no sheet when there is nothing in the range", () => {
    expect(oldFormatSheets({ ...data, records: [], entries: [] })).toEqual([]);
  });
});

describe("new format", () => {
  it("has About, Summary by day, Attendance and Plucking", () => {
    const sheets = newFormatSheets(data);
    expect(sheets.map((s) => s.name)).toEqual(["About", "Summary by day", "Attendance", "Plucking"]);
    const summary = grid(sheets[1]?.rows ?? []);
    expect(summary[1]).toEqual(["2026-10-26", 0, 1, 0, 0, 2, 29, 0]);
    expect(summary[2]).toEqual(["2026-10-27", 0, 0, 1, 0, 0, 0, 0]);
    const attendance = grid(sheets[2]?.rows ?? []);
    expect(attendance).toHaveLength(4);
    expect(attendance[2]?.slice(0, 4)).toEqual(["2026-10-26", "Night", "GLZ002", "Sanjay"]);
    const plucking = grid(sheets[3]?.rows ?? []);
    expect(plucking[1]?.slice(0, 4)).toEqual(["2026-10-26", "GLZ002", "Sanjay", "Coffee"]);
    expect(plucking).toHaveLength(3);
  });
});

describe("several estates in one file", () => {
  const other: ExportData = {
    ...data,
    estate: { id: "e2", code: "BYV", name: "Byson Valley" },
    records: [{ ...(data.records[0] as ExportData["records"][number]), businessDate: "2026-10-27" }],
    entries: [],
  };

  it("gives each date a sheet per estate, in date and estate order", () => {
    const sheets = oldFormatSheetsFor([data, other]);
    expect(sheets.map((s) => s.name)).toEqual(["26-10-2026 GLZ", "27-10-2026 GLZ", "27-10-2026 BYV"]);
    expect(grid(sheets[2]?.rows ?? [])[1]).toEqual(expect.arrayContaining(["Byson Valley", "27.10.2026"]));
  });

  it("keeps a single estate's file as it was", () => {
    expect(oldFormatSheetsFor([data]).map((s) => s.name)).toEqual(["26-10-2026", "27-10-2026"]);
    expect(newFormatSheetsFor([data]).map((s) => s.name)).toEqual(["About", "Summary by day", "Attendance", "Plucking"]);
  });

  it("adds an Estate column to the new-format tables", () => {
    const sheets = newFormatSheetsFor([data, other]);
    const attendance = grid(sheets[2]?.rows ?? []);
    expect(attendance[0]?.[0]).toBe("Estate");
    expect(attendance.slice(1).map((r) => r[0])).toEqual(["GLZ", "GLZ", "GLZ", "BYV"]);
    expect(grid(sheets[0]?.rows ?? [])[1]?.[1]).toContain("Byson Valley (BYV)");
  });
});
