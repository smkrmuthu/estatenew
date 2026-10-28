import { describe, expect, it } from "vitest";
import { CsvError, csvCell, parseCsv, parseImport } from "../src";

describe("parseCsv", () => {
  it("handles quotes, CRLF, BOM and blank lines", () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n\r\n1,2')).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"'],
      ["1", "2"],
    ]);
  });
  it("rejects unclosed quotes and empty files", () => {
    expect(() => parseCsv('a\n"x')).toThrow(CsvError);
    expect(() => parseCsv("a,b\n")).toThrow(/at least one data row/);
  });
  it("escapes formula-like cells on export", () => {
    expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
  });
});

describe("parseImport", () => {
  it("parses fields with crops, varieties and acres", () => {
    const r = parseImport("fields", "estate_code,code,name,area_acres,crops,varieties\nGLZ,SK,Super Kadu,10.5,COFFEE;PEPPER,CG;S9\n");
    expect(r.errors).toEqual([]);
    expect(r.rows[0]?.value).toEqual({ estateCode: "GLZ", code: "SK", name: "Super Kadu", areaCentiAcres: 1050, crops: ["COFFEE", "PEPPER"], varietyCodes: ["CG", "S9"] });
  });
  it("reports missing and unknown columns", () => {
    const r = parseImport("workers", "estate_code,name,gender\nGLZ,A,F\n");
    expect(r.errors.map((e) => e.column).sort()).toEqual(["employee_code", "gender"]);
  });
  it("reports row errors, duplicates and formula injection", () => {
    const r = parseImport("workers", "estate_code,employee_code,name\nGLZ,W1,Ann\nGLZ,w1,Bob\nGLZ,W2,=cmd()\nGLZ,,Cat\n");
    expect(r.rows.map((x) => x.key)).toEqual(["W1"]);
    expect(r.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ row: 3, message: "Duplicate of row 2" }),
        expect.objectContaining({ row: 4, column: "name" }),
        expect.objectContaining({ row: 5, column: "employee_code", message: "Required" }),
      ]),
    );
  });
  it("defaults field crop to coffee and rejects unknown crops", () => {
    expect(parseImport("fields", "estate_code,code,name\nGLZ,F1,One\n").rows[0]?.value.crops).toEqual(["COFFEE"]);
    expect(parseImport("varieties", "code,name,crop\nX,Y,TEA\n").errors[0]?.column).toBe("crop");
  });
});
