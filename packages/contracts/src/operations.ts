import { MAX_SYNC_BATCH, SHIFTS, SYNC_SCHEMA_VERSION } from "@cemms/domain";
import { z } from "zod";
import { businessDate, crop, entityType, id, isoInstant, kgString, reason, remarks } from "./common";

/** Optional so changes queued before shifts existed still count as the Day register. */
const shift = z.enum(SHIFTS).optional();

export const attendanceRecordPayload = z.object({
  businessDate,
  shift,
  workerId: id,
  statusCode: z.string().max(20),
  dayFraction: z.enum(["FULL", "HALF"]).nullish(),
  fieldId: id.nullish(),
  jobTypeId: id.nullish(),
  remarks,
});
export type AttendanceRecordPayload = z.infer<typeof attendanceRecordPayload>;

export const attendanceSheetSubmitPayload = z.object({ businessDate, shift });

export const musterEntryPayload = z.object({
  businessDate,
  workerId: id,
  fieldId: id,
  subdivision: z.string().trim().max(40).nullish(),
  crop,
  varietyId: id.nullish(),
  grossKg: kgString,
  bags: z.number().int().min(0).max(100),
  tareKg: kgString.nullish(),
  remarks,
});
export type MusterEntryPayload = z.infer<typeof musterEntryPayload>;

export const dailyLogEntryPayload = z.object({
  businessDate,
  kindId: id,
  readingAt: isoInstant,
  value: z.string().trim().min(1).max(200),
  remarks,
});
export type DailyLogEntryPayload = z.infer<typeof dailyLogEntryPayload>;

export const voidPayload = z.object({ reason });

export const mutation = z.object({
  mutationId: id,
  entityType,
  entityId: id,
  op: z.enum(["upsert", "create", "submit", "void"]),
  estateId: id,
  deviceId: id,
  schemaVersion: z.literal(SYNC_SCHEMA_VERSION),
  capturedAt: isoInstant,
  baseVersion: z.number().int().min(0),
  payload: z.unknown(),
  payloadHash: z.string().regex(/^[0-9a-f]{64}$/),
});
export type Mutation = z.infer<typeof mutation>;

export const syncPush = z.object({
  deviceId: id,
  /** How many entries are still waiting on the device after this batch (reported, not trusted). */
  pendingCount: z.number().int().min(0).max(100_000),
  mutations: z.array(mutation).max(MAX_SYNC_BATCH),
});

/** Payload schema for each (entityType, op) the sync endpoint accepts. */
export const MUTATION_PAYLOADS = {
  "attendance_record:upsert": attendanceRecordPayload,
  "attendance_sheet:submit": attendanceSheetSubmitPayload,
  "muster_entry:create": musterEntryPayload,
  "muster_entry:void": voidPayload,
  "dailylog_entry:create": dailyLogEntryPayload,
  "dailylog_entry:void": voidPayload,
} as const;
export type MutationKind = keyof typeof MUTATION_PAYLOADS;

export const sheetAction = z.object({ action: z.enum(["approve", "return"]), reason: reason.optional(), shift });
export const attendanceCorrection = attendanceRecordPayload.omit({ businessDate: true, workerId: true, shift: true }).extend({ reason, baseVersion: z.number().int().min(1) });
export const musterCorrection = musterEntryPayload.omit({ businessDate: true, workerId: true }).extend({ reason, baseVersion: z.number().int().min(1) });
export const dailyLogCorrection = z.object({ value: z.string().trim().min(1).max(200), remarks, reason, baseVersion: z.number().int().min(1) });
export const conflictResolution = z.object({ keep: z.enum(["server", "incoming"]), reason });
