import { isBusinessDate, SYNC_ENTITY_TYPES, UUID_V7_PATTERN } from "@cemms/domain";
import { z } from "zod";

export const id = z.string().regex(UUID_V7_PATTERN, "Must be a UUIDv7");
export const businessDate = z.string().refine(isBusinessDate, "Use a date like 2026-11-01");
export const kgString = z
  .string()
  .trim()
  .regex(/^\d{1,7}(\.\d{1,3})?$/, "Enter kilograms, for example 12.5");
export const reason = z.string().trim().min(3, "Give a reason").max(500);
export const remarks = z.string().trim().max(500).nullish();
export const code = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9 ._\-/]{0,39}$/, "Use letters and numbers (up to 40)");
export const name = z.string().trim().min(1, "Required").max(120);
export const isoInstant = z.string().datetime({ offset: true });
export const crop = z.enum(["COFFEE", "PEPPER"]);
export const entityType = z.enum(SYNC_ENTITY_TYPES);

export const problem = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number(),
  code: z.string(),
  detail: z.string().optional(),
  fieldErrors: z.record(z.string(), z.string()).optional(),
  requestId: z.string().optional(),
});
export type Problem = z.infer<typeof problem>;
