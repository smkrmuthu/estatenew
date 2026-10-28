/**
 * Weights are integer grams. Input comes as a decimal kilogram string with at most
 * three decimal places; no floating point is used for business arithmetic (ADR-0007).
 */

export type Grams = number & { readonly __grams: unique symbol };

export const MAX_WEIGH_IN_GRAMS = 500_000; // 500 kg sanity bound for one weigh-in

const KG_PATTERN = /^(\d{1,7})(?:\.(\d{1,3}))?$/;

export class WeightError extends Error {
  constructor(
    readonly code: "WEIGHT_FORMAT" | "WEIGHT_NEGATIVE" | "WEIGHT_TOO_LARGE" | "NET_NEGATIVE",
    message: string,
  ) {
    super(message);
  }
}

/** Parse "12.345" kg into 12345 g. Rejects signs, exponents, commas and more than 3 decimals. */
export function parseKg(input: string): Grams {
  const value = input.trim();
  const match = KG_PATTERN.exec(value);
  if (!match) throw new WeightError("WEIGHT_FORMAT", "Enter the weight in kilograms, for example 12.5");
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? "").padEnd(3, "0"));
  return asGrams(whole * 1000 + fraction);
}

export function asGrams(value: number): Grams {
  if (!Number.isSafeInteger(value)) throw new WeightError("WEIGHT_FORMAT", "Weight must be a whole number of grams");
  if (value < 0) throw new WeightError("WEIGHT_NEGATIVE", "Weight cannot be negative");
  return value as Grams;
}

/** Format grams as kilograms with exactly three decimals, e.g. 12345 -> "12.345". */
export function formatKg(grams: number): string {
  const sign = grams < 0 ? "-" : "";
  const abs = Math.abs(grams);
  return `${sign}${Math.trunc(abs / 1000)}.${String(abs % 1000).padStart(3, "0")}`;
}

export type TareMode = "NONE" | "MANUAL" | "PER_BAG";

export interface WeighInInput {
  grossGrams: number;
  bags: number;
  /** Tare entered by hand (MANUAL mode). */
  tareGrams?: number;
  /** Configured empty-bag weight (PER_BAG mode). Unconfirmed: OC-87. */
  perBagTareGrams?: number;
}

export interface WeighInWeights {
  grossGrams: Grams;
  tareGrams: Grams;
  netGrams: Grams;
  bags: number;
  tareMode: TareMode;
}

/**
 * Compute net from validated components. The server always recomputes this;
 * a client-supplied net is never trusted.
 */
export function computeWeighIn(input: WeighInInput, mode: TareMode): WeighInWeights {
  const gross = asGrams(input.grossGrams);
  if (gross > MAX_WEIGH_IN_GRAMS) throw new WeightError("WEIGHT_TOO_LARGE", "One weigh-in cannot be more than 500 kg");
  if (!Number.isSafeInteger(input.bags) || input.bags < 0 || input.bags > 100) {
    throw new WeightError("WEIGHT_FORMAT", "Number of bags must be a whole number from 0 to 100");
  }
  let tare: Grams;
  switch (mode) {
    case "NONE":
      tare = asGrams(0);
      break;
    case "MANUAL":
      tare = asGrams(input.tareGrams ?? 0);
      break;
    case "PER_BAG":
      if (input.perBagTareGrams === undefined) throw new WeightError("WEIGHT_FORMAT", "Empty-bag weight is not configured");
      tare = asGrams(input.bags * asGrams(input.perBagTareGrams));
      break;
  }
  const net = gross - tare;
  if (net < 0) throw new WeightError("NET_NEGATIVE", "Tare cannot be more than the gross weight");
  return { grossGrams: gross, tareGrams: tare, netGrams: net as Grams, bags: input.bags, tareMode: mode };
}

export function sumGrams(values: Iterable<number>): Grams {
  let total = 0;
  for (const v of values) total += asGrams(v);
  return asGrams(total);
}
