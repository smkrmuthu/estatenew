import { describe, expect, it } from "vitest";
import { computeWeighIn, formatKg, parseKg, sumGrams, WeightError } from "../src/weights";

describe("parseKg", () => {
  it("parses kilograms into integer grams without floats", () => {
    expect(parseKg("12.5")).toBe(12500);
    expect(parseKg("0.001")).toBe(1);
    expect(parseKg("  7 ")).toBe(7000);
    expect(parseKg("0.1") + parseKg("0.2")).toBe(300);
  });
  it.each(["", "-1", "1e3", "1,5", "1.2345", "abc", "+3", "1."])("rejects %j", (v) => {
    expect(() => parseKg(v)).toThrow(WeightError);
  });
});

describe("computeWeighIn", () => {
  it("MANUAL subtracts the entered tare", () => {
    const w = computeWeighIn({ grossGrams: 20500, bags: 2, tareGrams: 1000 }, "MANUAL");
    expect(w).toMatchObject({ grossGrams: 20500, tareGrams: 1000, netGrams: 19500, bags: 2, tareMode: "MANUAL" });
  });
  it("MANUAL with no tare entered keeps the gross", () => {
    expect(computeWeighIn({ grossGrams: 1234, bags: 1 }, "MANUAL").netGrams).toBe(1234);
  });
  it("PER_BAG multiplies the configured bag weight", () => {
    expect(computeWeighIn({ grossGrams: 30000, bags: 3, perBagTareGrams: 400 }, "PER_BAG").netGrams).toBe(28800);
  });
  it("PER_BAG without a configured weight is refused", () => {
    expect(() => computeWeighIn({ grossGrams: 30000, bags: 3 }, "PER_BAG")).toThrow(/not configured/);
  });
  it("NONE ignores tare", () => {
    expect(computeWeighIn({ grossGrams: 5000, bags: 1, tareGrams: 999 }, "NONE").netGrams).toBe(5000);
  });
  it("refuses a negative net, a huge gross and bad bag counts", () => {
    expect(() => computeWeighIn({ grossGrams: 500, bags: 1, tareGrams: 501 }, "MANUAL")).toThrow(/Tare cannot/);
    expect(() => computeWeighIn({ grossGrams: 500_001, bags: 1 }, "MANUAL")).toThrow(/500 kg/);
    expect(() => computeWeighIn({ grossGrams: 100, bags: -1 }, "MANUAL")).toThrow(/bags/);
    expect(() => computeWeighIn({ grossGrams: 100, bags: 1.5 }, "MANUAL")).toThrow(/bags/);
    expect(() => computeWeighIn({ grossGrams: 10.5, bags: 1 }, "MANUAL")).toThrow(/whole number/);
  });
});

describe("format and sum", () => {
  it("formats grams as kilograms", () => {
    expect(formatKg(12345)).toBe("12.345");
    expect(formatKg(5)).toBe("0.005");
    expect(formatKg(-1500)).toBe("-1.500");
  });
  it("sums exactly", () => {
    expect(sumGrams([100, 200, 300])).toBe(600);
  });
});
