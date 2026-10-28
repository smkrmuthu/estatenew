import { IMPORT_KINDS } from "@cemms/domain";
import { z } from "zod";
import { code, crop, id, name } from "./common";

export const estateInput = z.object({ code, name, timeZone: z.string().max(60).optional() });
export const fieldInput = z.object({
  estateId: id,
  code,
  name,
  areaCentiAcres: z.number().int().min(0).max(10_000_000).nullable().optional(),
  crops: z.array(crop).min(1),
  varietyIds: z.array(id).max(20).default([]),
  active: z.boolean().default(true),
});
export const varietyInput = z.object({ code, name, crop, active: z.boolean().default(true) });
export const jobTypeInput = z.object({ code, name, active: z.boolean().default(true) });
export const workerInput = z.object({ estateId: id, employeeCode: code, name, active: z.boolean().default(true) });
export const logKindInput = z.object({
  code,
  label: name,
  unit: z.string().trim().max(20).nullable(),
  valueType: z.enum(["NUMBER", "TEXT"]),
  decimals: z.number().int().min(0).max(3),
  minScaled: z.number().int().nullable(),
  maxScaled: z.number().int().nullable(),
  active: z.boolean().default(true),
});

export const importRequest = z.object({ kind: z.enum(IMPORT_KINDS), csv: z.string().min(1).max(1_000_000) });
export const importCommit = importRequest.extend({ previewHash: z.string().regex(/^[0-9a-f]{64}$/) });

export const settingChange = z.object({ key: z.string().max(80), value: z.unknown() });
