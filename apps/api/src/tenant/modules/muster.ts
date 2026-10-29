import type { MusterEntryPayload } from "@cemms/contracts";
import { computeWeighIn, formatKg, parseKg, type TareMode, WeightError } from "@cemms/domain";
import { and, eq } from "drizzle-orm";
import { AppError } from "../../core/errors";
import { assertFound, type Db, staleVersion, type TenantContext } from "../context";
import { fieldVarieties, musterEntries, varieties } from "../schema";
import type { ApplyMeta, ApplyOutcome } from "./attendance";
import { checkCaptureDate } from "./capture";
import { activeField, activeWorker, getEstate } from "./organization";
import { setting } from "./settings";

type Core = Pick<MusterEntryPayload, "fieldId" | "subdivision" | "crop" | "varietyId" | "grossKg" | "bags" | "tareKg" | "remarks">;

/**
 * Validate references and recompute weights on the server (client net is never trusted).
 * `tareKg` is what the caller's tare comes to: the estate default for supervisors, or the entered value.
 */
function validated(db: Db, estateId: string, p: Core, tareKg: string | null | undefined = p.tareKg) {
  const field = activeField(db, p.fieldId, estateId);
  if (!setting(db, "crops.enabled").includes(p.crop)) throw new AppError(422, "CROP_NOT_ENABLED", "This crop is not switched on", { crop: "Not enabled" });
  if (!field.crops.includes(p.crop)) throw new AppError(422, "CROP_NOT_ON_FIELD", "This crop is not grown in this field", { crop: "Not grown here" });
  if (p.varietyId) {
    const v = db.select().from(varieties).where(eq(varieties.id, p.varietyId)).get();
    if (!v?.active || v.crop !== p.crop) throw new AppError(422, "VARIETY_UNKNOWN", "Choose a variety of this crop", { varietyId: "Not valid" });
    const fieldList = db.select().from(fieldVarieties).where(eq(fieldVarieties.fieldId, field.id)).all();
    if (fieldList.length && !fieldList.some((x) => x.varietyId === p.varietyId))
      throw new AppError(422, "VARIETY_NOT_ON_FIELD", "This variety is not listed for this field", { varietyId: "Not on field" });
  } else if (setting(db, "muster.variety.required")) {
    throw new AppError(422, "VARIETY_REQUIRED", "Choose a variety", { varietyId: "Required" });
  }
  const mode = setting(db, "muster.tare.mode") as TareMode;
  try {
    const w = computeWeighIn({ grossGrams: parseKg(p.grossKg), bags: p.bags, tareGrams: tareKg ? parseKg(tareKg) : 0, perBagTareGrams: setting(db, "muster.tare.perBagGrams") ?? undefined }, mode);
    return {
      fieldId: field.id,
      subdivision: p.subdivision?.trim() || null,
      crop: p.crop,
      varietyId: p.varietyId ?? null,
      grossG: w.grossGrams,
      bags: w.bags,
      tareG: w.tareGrams,
      netG: w.netGrams,
      tareMode: w.tareMode,
      remarks: p.remarks?.trim() || null,
    };
  } catch (e) {
    if (e instanceof WeightError) throw new AppError(422, e.code, e.message, { grossKg: e.message });
    throw e;
  }
}

/**
 * A supervisor cannot choose the tare: every weigh-in gets the estate's default, whatever the phone sent.
 * A manager or owner may enter another value; leaving it blank uses the default.
 */
function tareFor(ctx: TenantContext, estate: { id: string; defaultTareG: number }, entered: string | null | undefined): string | null {
  if (ctx.can("muster.correct", estate.id) && entered) return entered;
  return formatKg(estate.defaultTareG);
}

export function applyMusterCreate(ctx: TenantContext, db: Db, meta: ApplyMeta, payload: MusterEntryPayload): ApplyOutcome {
  ctx.require("muster.capture", meta.estateId);
  const estate = getEstate(db, meta.estateId);
  checkCaptureDate(ctx, estate, payload.businessDate, meta.capturedAt, "muster.correct");
  activeWorker(db, payload.workerId, estate.id);
  if (db.select().from(musterEntries).where(eq(musterEntries.id, meta.entityId)).get()) throw new AppError(409, "ENTITY_EXISTS", "This weigh-in was already saved");
  const row = {
    id: meta.entityId,
    tenantId: ctx.scope.tenantId,
    estateId: estate.id,
    businessDate: payload.businessDate,
    workerId: payload.workerId,
    ...validated(db, estate.id, payload, tareFor(ctx, estate, payload.tareKg)),
    status: "ACTIVE" as const,
    voidReason: null,
    capturedBy: ctx.scope.userId,
    deviceId: ctx.scope.deviceId,
    capturedAt: meta.capturedAt,
    receivedAt: ctx.nowIso(),
    version: 1,
  };
  db.insert(musterEntries).values(row).run();
  ctx.revision(db, "muster_entry", row.id, 1, row, "create", null, meta.mutationId);
  ctx.audit(db, { action: "muster.entry.create", entityType: "muster_entry", entityId: row.id, estateId: estate.id, after: row, mutationId: meta.mutationId });
  ctx.emit(db, "muster.entry.created", "muster_entry", row.id, { estateId: estate.id, businessDate: row.businessDate, crop: row.crop, netG: row.netG });
  return { kind: "accepted", entityId: row.id, version: 1 };
}

/** A supervisor may void their own entry for the day it was made; managers any entry. */
export function applyMusterVoid(ctx: TenantContext, db: Db, meta: ApplyMeta, reason: string): ApplyOutcome {
  const before = assertFound(db.select().from(musterEntries).where(eq(musterEntries.id, meta.entityId)).get(), "Weigh-in");
  if (before.estateId !== meta.estateId) throw new AppError(422, "ENTITY_MISMATCH", "This weigh-in belongs to another estate");
  const own = before.capturedBy === ctx.scope.userId && ctx.can("muster.capture", before.estateId);
  if (!own) ctx.require("muster.correct", before.estateId);
  if (before.status === "VOID") throw new AppError(409, "ALREADY_VOID", "This weigh-in is already cancelled");
  if (before.version !== meta.baseVersion) throw staleVersion();
  const after = { ...before, status: "VOID" as const, voidReason: reason, version: before.version + 1 };
  db.update(musterEntries).set(after).where(eq(musterEntries.id, before.id)).run();
  ctx.revision(db, "muster_entry", before.id, after.version, after, "void", reason, meta.mutationId);
  ctx.audit(db, { action: "muster.entry.void", entityType: "muster_entry", entityId: before.id, estateId: before.estateId, reason, before, after, mutationId: meta.mutationId });
  ctx.emit(db, "muster.entry.voided", "muster_entry", before.id, { estateId: before.estateId, businessDate: before.businessDate });
  return { kind: "accepted", entityId: before.id, version: after.version };
}

export function correctMuster(ctx: TenantContext, entryId: string, input: Core & { reason: string; baseVersion: number }) {
  return ctx.tx((db) => {
    const before = assertFound(db.select().from(musterEntries).where(eq(musterEntries.id, entryId)).get(), "Weigh-in");
    ctx.require("muster.correct", before.estateId);
    if (before.status === "VOID") throw new AppError(409, "ALREADY_VOID", "A cancelled weigh-in cannot be corrected");
    if (before.version !== input.baseVersion) throw staleVersion();
    const after = { ...before, ...validated(db, before.estateId, input), version: before.version + 1, receivedAt: ctx.nowIso() };
    db.update(musterEntries).set(after).where(eq(musterEntries.id, entryId)).run();
    ctx.revision(db, "muster_entry", entryId, after.version, after, "correct", input.reason, null);
    ctx.audit(db, { action: "muster.entry.correct", entityType: "muster_entry", entityId: entryId, estateId: before.estateId, reason: input.reason, before, after });
    ctx.emit(db, "muster.entry.corrected", "muster_entry", entryId, { estateId: before.estateId, businessDate: before.businessDate });
    return after;
  });
}

export function listMuster(ctx: TenantContext, estateId: string, businessDate: string) {
  ctx.require("muster.read", estateId);
  getEstate(ctx.db, estateId);
  return ctx.db
    .select()
    .from(musterEntries)
    .where(and(eq(musterEntries.estateId, estateId), eq(musterEntries.businessDate, businessDate)))
    .all();
}
