/**
 * Daily log readings. Kinds are tenant configuration (OC-100 open): nothing about
 * temperature or rain is hard-coded here.
 */

export interface LogKindDef {
  code: string;
  label: string;
  unit: string | null;
  valueType: "NUMBER" | "TEXT";
  /** Decimal places for NUMBER kinds (0 to 3). */
  decimals: number;
  /** Bounds in scaled integer units, inclusive. */
  minScaled: number | null;
  maxScaled: number | null;
}

export class ReadingError extends Error {
  constructor(
    readonly code: "READING_FORMAT" | "READING_RANGE" | "READING_TOO_LONG",
    message: string,
  ) {
    super(message);
  }
}

/** Parse a decimal string into an integer scaled by 10^decimals, without floats. */
export function parseScaled(input: string, decimals: number): number {
  const m = /^(-)?(\d{1,9})(?:\.(\d+))?$/.exec(input.trim());
  if (!m) throw new ReadingError("READING_FORMAT", "Enter a number");
  const frac = m[3] ?? "";
  if (frac.length > decimals) throw new ReadingError("READING_FORMAT", decimals === 0 ? "Enter a whole number" : `Use at most ${decimals} decimal places`);
  const scaled = Number(m[2]) * 10 ** decimals + Number(frac.padEnd(decimals, "0") || "0");
  return m[1] ? -scaled : scaled;
}

export function formatScaled(scaled: number, decimals: number): string {
  if (decimals === 0) return String(scaled);
  const sign = scaled < 0 ? "-" : "";
  const abs = Math.abs(scaled);
  const base = 10 ** decimals;
  return `${sign}${Math.trunc(abs / base)}.${String(abs % base).padStart(decimals, "0")}`;
}

export type Reading = { valueScaled: number; valueText: null } | { valueScaled: null; valueText: string };

export function parseReading(kind: LogKindDef, input: string): Reading {
  if (kind.valueType === "TEXT") {
    const text = input.trim();
    if (!text) throw new ReadingError("READING_FORMAT", "Enter a value");
    if (text.length > 200) throw new ReadingError("READING_TOO_LONG", "Use at most 200 characters");
    return { valueScaled: null, valueText: text };
  }
  const v = parseScaled(input, kind.decimals);
  if ((kind.minScaled !== null && v < kind.minScaled) || (kind.maxScaled !== null && v > kind.maxScaled)) {
    const lo = kind.minScaled === null ? "" : formatScaled(kind.minScaled, kind.decimals);
    const hi = kind.maxScaled === null ? "" : formatScaled(kind.maxScaled, kind.decimals);
    throw new ReadingError("READING_RANGE", `Enter a value between ${lo || "any"} and ${hi || "any"}`);
  }
  return { valueScaled: v, valueText: null };
}
