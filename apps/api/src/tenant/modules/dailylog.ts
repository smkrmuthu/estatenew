import type { DailyLogEntryPayload } from "@cemms/contracts";
import { parseReading, ReadingError } from "@cemms/domain";
import { and, eq } from "drizzle-orm";
import { AppError } from "../../core/errors";
import { assertFound, type Db, staleVersion, type TenantContext } from "../context";
import { dailylogEntries, logKinds } from "../schema";
import type { ApplyMeta, ApplyOutcome } from "./attendance";
import { checkCaptureDate } from "./capture";
import { getEstate } from "./organization";

function reading(db: Db, kindId: string, value: string) {
  const kind = db.select().from(logKinds).where(eq(logKinds.id, kindId)).get();
  if (!kind?.active) throw new AppError(422, "LOG_KIND_UNKNOWN", "This reading type is not in use", { kindId: "Unknown" });
  try {
    return parseReading(kind, value);
  } catch (e) {
    if (e instanceof ReadingError) throw new AppError(422, e.code, e.message, { value: e.message });
    throw e;
  }
}

export function applyDailyLogCreate(ctx: TenantContext, db: Db, meta: ApplyMeta, p: DailyLogEntryPayload): ApplyOutcome {
  ctx.require("dailylog.capture", meta.estateId);
  const estate = getEstate(db, meta.estateId);
  checkCaptureDate(ctx, estate, p.businessDate, meta.capturedAt, "dailylog.correct");
  if (db.select().from(dailylogEntries).where(eq(dailylogEntries.id, meta.entityId)).get()) throw new AppError(409, "ENTITY_EXISTS", "This reading was already saved");
  const row = {
    id: meta.entityId,
    tenantId: ctx.scope.tenantId,
    estateId: estate.id,
    businessDate: p.businessDate,
    kindId: p.kindId,
    readingAt: new Date(p.readingAt).toISOString(),
    ...reading(db, p.kindId, p.value),
    remarks: p.remarks?.trim() || null,
    status: "ACTIVE" as const,
    voidReason: null,
    capturedBy: ctx.scope.userId,
    deviceId: ctx.scope.deviceId,
    capturedAt: meta.capturedAt,
    receivedAt: ctx.nowIso(),
    version: 1,
  };
  db.insert(dailylogEntries).values(row).run();
  ctx.revision(db, "dailylog_entry", row.id, 1, row, "create", null, meta.mutationId);
  ctx.audit(db, { action: "dailylog.entry.create", entityType: "dailylog_entry", entityId: row.id, estateId: estate.id, after: row, mutationId: meta.mutationId });
  ctx.emit(db, "dailylog.entry.created", "dailylog_entry", row.id, { estateId: estate.id, businessDate: row.businessDate });
  return { kind: "accepted", entityId: row.id, version: 1 };
}

export function applyDailyLogVoid(ctx: TenantContext, db: Db, meta: ApplyMeta, reason: string): ApplyOutcome {
  const before = assertFound(db.select().from(dailylogEntries).where(eq(dailylogEntries.id, meta.entityId)).get(), "Reading");
  if (before.estateId !== meta.estateId) throw new AppError(422, "ENTITY_MISMATCH", "This reading belongs to another estate");
  const own = before.capturedBy === ctx.scope.userId && ctx.can("dailylog.capture", before.estateId);
  if (!own) ctx.require("dailylog.correct", before.estateId);
  if (before.status === "VOID") throw new AppError(409, "ALREADY_VOID", "This reading is already cancelled");
  if (before.version !== meta.baseVersion) throw staleVersion();
  const after = { ...before, status: "VOID" as const, voidReason: reason, version: before.version + 1 };
  db.update(dailylogEntries).set(after).where(eq(dailylogEntries.id, before.id)).run();
  ctx.revision(db, "dailylog_entry", before.id, after.version, after, "void", reason, meta.mutationId);
  ctx.audit(db, { action: "dailylog.entry.void", entityType: "dailylog_entry", entityId: before.id, estateId: before.estateId, reason, before, after, mutationId: meta.mutationId });
  return { kind: "accepted", entityId: before.id, version: after.version };
}

export function correctDailyLog(ctx: TenantContext, entryId: string, input: { value: string; remarks?: string | null; reason: string; baseVersion: number }) {
  return ctx.tx((db) => {
    const before = assertFound(db.select().from(dailylogEntries).where(eq(dailylogEntries.id, entryId)).get(), "Reading");
    ctx.require("dailylog.correct", before.estateId);
    if (before.status === "VOID") throw new AppError(409, "ALREADY_VOID", "A cancelled reading cannot be corrected");
    if (before.version !== input.baseVersion) throw staleVersion();
    const after = { ...before, ...reading(db, before.kindId, input.value), remarks: input.remarks?.trim() || null, version: before.version + 1, receivedAt: ctx.nowIso() };
    db.update(dailylogEntries).set(after).where(eq(dailylogEntries.id, entryId)).run();
    ctx.revision(db, "dailylog_entry", entryId, after.version, after, "correct", input.reason, null);
    ctx.audit(db, { action: "dailylog.entry.correct", entityType: "dailylog_entry", entityId: entryId, estateId: before.estateId, reason: input.reason, before, after });
    return after;
  });
}

export function listDailyLog(ctx: TenantContext, estateId: string, businessDate: string) {
  ctx.require("dailylog.read", estateId);
  getEstate(ctx.db, estateId);
  return ctx.db
    .select()
    .from(dailylogEntries)
    .where(and(eq(dailylogEntries.estateId, estateId), eq(dailylogEntries.businessDate, businessDate)))
    .all();
}
