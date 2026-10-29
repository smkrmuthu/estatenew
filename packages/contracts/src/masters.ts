import { EMPLOYMENT_TYPES, GENDERS, IMPORT_KINDS, LAND_USES } from "@cemms/domain";
import { z } from "zod";
import { code, crop, id, kgString, name, reason } from "./common";

export const estateInput = z.object({ code, name, timeZone: z.string().max(60).optional() });
/** The tare taken off each weigh-in at this estate, in kilograms. */
export const estateTareInput = z.object({ tareKg: kgString, reason: reason.optional() });
export const fieldInput = z.object({
  estateId: id,
  /** Without a code the server allocates the next one for the estate, like GLZ-07. */
  code: code.optional(),
  name,
  areaCentiAcres: z.number().int().min(0).max(10_000_000).nullable().optional(),
  elevationM: z.number().int().min(0).max(9000).nullable().optional(),
  expectedCherryKg: z.number().int().min(0).max(10_000_000).nullable().optional(),
  crops: z.array(crop).min(1),
  varietyIds: z.array(id).max(20).default([]),
  /** When given, replaces the field's subdivisions (labelled A, B, C by order) and the field's varieties follow from them. */
  subdivisions: z
    .array(z.object({ landUse: z.enum(LAND_USES), varietyId: id.nullable().optional(), areaCentiAcres: z.number().int().min(1).max(10_000_000) }))
    .max(26)
    .optional(),
  active: z.boolean().default(true),
});
export const varietyInput = z.object({
  code,
  name,
  crop,
  active: z.boolean().default(true),
  /** Fields without subdivisions that grow this variety. Left out: the associations are not touched. A field with subdivisions takes its varieties from them. */
  fieldIds: z.array(id).max(500).optional(),
});
export const jobTypeInput = z.object({ code, name, countsAsPlucking: z.boolean().default(false), active: z.boolean().default(true) });
/** Deleting a worker or field needs a reason for the audit trail. */
export const deleteMaster = z.object({ reason });

/** Without an employeeCode the server allocates the next one for the estate. */
export const workerInput = z.object({
  estateId: id,
  employeeCode: code.optional(),
  name,
  gender: z.enum(GENDERS).nullable().optional(),
  employmentType: z.enum(EMPLOYMENT_TYPES).nullable().optional(),
  /** Where the worker comes from, for example a village or state. */
  area: z.string().trim().max(120).nullable().optional(),
  /** The estates the worker is allotted to (they appear in each estate's register and weigh-in). Defaults to the worker's own estate. */
  estateIds: z.array(id).min(1).max(50).optional(),
  active: z.boolean().default(true),
});
export const logKindInput = z.object({
  code,
  label: name,
  unit: z.string().trim().max(20).nullable(),
  valueType: z.enum(["NUMBER", "TEXT"]),
  decimals: z.number().int().min(0).max(3),
  minScaled: z.number().int().nullable(),
  maxScaled: z.number().int().nullable(),
  expectedPerDay: z.number().int().min(1).max(48).nullable().optional(),
  active: z.boolean().default(true),
});

export const importRequest = z.object({ kind: z.enum(IMPORT_KINDS), csv: z.string().min(1).max(1_000_000) });
export const importCommit = importRequest.extend({ previewHash: z.string().regex(/^[0-9a-f]{64}$/) });

export const settingChange = z.object({ key: z.string().max(80), value: z.unknown() });
