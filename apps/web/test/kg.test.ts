import { parseKg } from "@cemms/domain";
import { describe, expect, it } from "vitest";
import { normalizeKg } from "../src/lib/kg";

describe("normalizeKg", () => {
  it("accepts weights typed without a leading or trailing digit", () => {
    expect(normalizeKg(".2")).toBe("0.2");
    expect(normalizeKg("4.")).toBe("4");
    expect(normalizeKg(" 4.5 ")).toBe("4.5");
    expect(parseKg(normalizeKg(".25"))).toBe(250);
  });
  it("leaves ordinary weights alone", () => {
    expect(normalizeKg("12.345")).toBe("12.345");
    expect(normalizeKg("0")).toBe("0");
  });
});
