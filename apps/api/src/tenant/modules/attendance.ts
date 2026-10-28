import type { AttendanceRecordPayload } from "@cemms/contracts";
import { type AttendanceStatusDef, DEFAULT_ATTENDANCE_STATUSES, editRequiresCorrection, normalizeAttendanceRecord, type SheetState, transitionSheet, uuidv7 } from "@cemms/domain";
import { and, desc, eq, lt, ne } from "drizzle-orm";
import { AppError } from "../../core/errors";
import { assertFound, type Db, staleVersion, type TenantContext } from "../context";
import { attendanceRecords, attendanceSheets, estates, syncConflicts } from "../schema";
import { checkCaptureDate } from "./capture";
import { activeField, activeJobType, activeWorker, getEstate } from "./organization";
import { setting } from "./settings";

export function enabledStatuses(db: Db): AttendanceStatusDef[] {
  const enabled = setting(db, "attendance.statuses.enabled");
  return DEFAULT_ATTENDANCE_STATUSES.map((s) => ({ ...s, active: enabled.includes(s.code) }));
}

function sheetFor(db: Db, ctx: TenantContext, estateId: string, businessDate: string, create: boolean) {
  const found = db
    .select()
    .from(attendanceSheets)
    .where(and(eq(attendanceSheets.estateId, estateId), eq(attendanceSheets.businessDate, businessDate)))
    .get();
  if (found || !create) return found;
  const row = { id: uuidv7(), tenantId: ctx.scope.tenantId, estateId, businessDate, state: "DRAFT" as SheetState, version: 1, createdAt: ctx.nowIso(), updatedAt: ctx.nowIso() };
  db.insert(attendanceSheets).values(row).run();
  return { ...row, submittedAt: null, submittedBy: null, approvedAt: null, approvedBy: null, returnedReason: null };
}

function validateRecord(db: Db, estateId: string, payload: Pick<AttendanceRecordPayload, "statusCode" | "dayFraction" | "fieldId" | "jobTypeId" | "remarks">) {
  const normalized = (() => {
    try {
      return normalizeAttendanceRecord(payload, enabledStatuses(db));
    } catch (e) {
      const err = e as { code: string; message: string; field?: string };
      throw new AppError(422, err.code, err.message, err.field ? { [err.field]: err.message } : undefined);
    }
  })();
  if (normalized.fieldId) activeField(db, normalized.fieldId, estateId);
  if (normalized.jobTypeId) activeJobType(db, normalized.jobTypeId);
  return normalized;
}

export interface ApplyMeta {
  mutationId: string;
  entityId: string;
  estateId: string;
  capturedAt: string;
  baseVersion: number;
}

export type ApplyOutcome = { kind: "accepted"; entityId: string; version: number } | { kind: "conflict"; entityId: string; version: number; conflictId: string; message: string };

/** Create or update one attendance record from a device mutation. */
export function applyAttendanceRecord(ctx: TenantContext, db: Db, meta: ApplyMeta, payload: AttendanceRecordPayload): ApplyOutcome {
  ctx.require("attendance.capture", meta.estateId);
  const estate = getEstate(db, meta.estateId);
  checkCaptureDate(ctx, estate, payload.businessDate, meta.capturedAt, "attendance.correct");
  activeWorker(db, payload.workerId, estate.id);
  const normalized = validateRecord(db, estate.id, payload);
  // A worker shared by several estates cannot be present in two estates on one day (the duplicate-attendance policy is not confirmed yet).
  if (normalized.presence === "PRESENT") {
    const elsewhere = db
      .select()
      .from(attendanceRecords)
      .where(
        and(
          eq(attendanceRecords.businessDate, payload.businessDate),
          eq(attendanceRecords.workerId, payload.workerId),
          eq(attendanceRecords.presence, "PRESENT"),
          ne(attendanceRecords.estateId, estate.id),
        ),
      )
      .get();
    if (elsewhere) {
      const where = db.select().from(estates).where(eq(estates.id, elsewhere.estateId)).get();
      throw new AppError(409, "WORKER_ELSEWHERE", `This worker is already marked present in ${where?.name ?? "another estate"} on this day`, { workerId: "Already present in another estate" });
    }
  }
  const sheet = sheetFor(db, ctx, estate.id, payload.businessDate, true);
  if (!sheet) throw new Error("sheet missing");
  if (editRequiresCorrection(sheet.state)) throw new AppError(409, "SHEET_LOCKED", "This day's attendance has been submitted. A manager must correct it.");
  const now = ctx.nowIso();
  const byId = db.select().from(attendanceRecords).where(eq(attendanceRecords.id, meta.entityId)).get();
  const data = { ...normalized, businessDate: payload.businessDate, workerId: payload.workerId };

  if (byId) {
    if (byId.workerId !== payload.workerId || byId.businessDate !== payload.businessDate || byId.estateId !== estate.id) {
      throw new AppError(422, "ENTITY_MISMATCH", "This record belongs to another worker or day");
    }
    if (byId.version !== meta.baseVersion) return openConflict(ctx, db, meta, byId, data, "Changed on another device since this phone last synced");
    const after = { ...byId, ...normalized, capturedBy: ctx.scope.userId, deviceId: ctx.scope.deviceId, capturedAt: meta.capturedAt, receivedAt: now, version: byId.version + 1 };
    db.update(attendanceRecords).set(after).where(eq(attendanceRecords.id, byId.id)).run();
    ctx.revision(db, "attendance_record", byId.id, after.version, after, "update", null, meta.mutationId);
    ctx.audit(db, { action: "attendance.record.update", entityType: "attendance_record", entityId: byId.id, estateId: estate.id, before: byId, after, mutationId: meta.mutationId });
    ctx.emit(db, "attendance.record.saved", "attendance_record", byId.id, { estateId: estate.id, businessDate: payload.businessDate });
    return { kind: "accepted", entityId: byId.id, version: after.version };
  }

  const sameWorker = db
    .select()
    .from(attendanceRecords)
    .where(and(eq(attendanceRecords.estateId, estate.id), eq(attendanceRecords.businessDate, payload.businessDate), eq(attendanceRecords.workerId, payload.workerId)))
    .get();
  if (sameWorker) return openConflict(ctx, db, meta, sameWorker, data, "This worker already has attendance for this day from another entry");
  const row = {
    id: meta.entityId,
    tenantId: ctx.scope.tenantId,
    estateId: estate.id,
    sheetId: sheet.id,
    ...data,
    capturedBy: ctx.scope.userId,
    deviceId: ctx.scope.deviceId,
    capturedAt: meta.capturedAt,
    receivedAt: now,
    version: 1,
  };
  db.insert(attendanceRecords).values(row).run();
  ctx.revision(db, "attendance_record", row.id, 1, row, "create", null, meta.mutationId);
  ctx.audit(db, { action: "attendance.record.create", entityType: "attendance_record", entityId: row.id, estateId: estate.id, after: row, mutationId: meta.mutationId });
  ctx.emit(db, "attendance.record.saved", "attendance_record", row.id, { estateId: estate.id, businessDate: payload.businessDate });
  return { kind: "accepted", entityId: row.id, version: 1 };
}

/** OC-103 is open: never pick a winner. Keep both versions for a manager to decide. */
function openConflict(ctx: TenantContext, db: Db, meta: ApplyMeta, server: typeof attendanceRecords.$inferSelect, incoming: Record<string, unknown>, message: string): ApplyOutcome {
  const conflictId = uuidv7();
  db.insert(syncConflicts)
    .values({
      id: conflictId,
      tenantId: ctx.scope.tenantId,
      estateId: server.estateId,
      entityType: "attendance_record",
      serverEntityId: server.id,
      incomingEntityId: meta.entityId,
      incomingJson: JSON.stringify({ ...incoming, capturedAt: meta.capturedAt }),
      serverJson: JSON.stringify(server),
      state: "OPEN",
      mutationId: meta.mutationId,
      deviceId: ctx.scope.deviceId,
      capturedBy: ctx.scope.userId,
      createdAt: ctx.nowIso(),
    })
    .run();
  ctx.audit(db, { action: "sync.conflict.open", entityType: "attendance_record", entityId: server.id, estateId: server.estateId, after: { conflictId, incoming }, mutationId: meta.mutationId });
  return { kind: "conflict", entityId: server.id, version: server.version, conflictId, message };
}

export function applySheetSubmit(ctx: TenantContext, db: Db, meta: ApplyMeta, businessDate: string): ApplyOutcome {
  ctx.require("attendance.submit", meta.estateId);
  getEstate(db, meta.estateId);
  const sheet = sheetFor(db, ctx, meta.estateId, businessDate, true);
  if (!sheet) throw new Error("sheet missing");
  if (sheet.state !== "DRAFT") throw new AppError(409, "SHEET_STATE", "This day's attendance was already submitted");
  const count = db.select().from(attendanceRecords).where(eq(attendanceRecords.sheetId, sheet.id)).all().length;
  if (count === 0) throw new AppError(422, "SHEET_EMPTY", "Mark at least one worker before submitting");
  const after = {
    ...sheet,
    state: transitionSheet(sheet.state, "submit"),
    submittedAt: ctx.nowIso(),
    submittedBy: ctx.scope.userId,
    returnedReason: null,
    version: sheet.version + 1,
    updatedAt: ctx.nowIso(),
  };
  db.update(attendanceSheets).set(after).where(eq(attendanceSheets.id, sheet.id)).run();
  ctx.audit(db, { action: "attendance.sheet.submit", entityType: "attendance_sheet", entityId: sheet.id, estateId: sheet.estateId, before: sheet, after, mutationId: meta.mutationId });
  ctx.emit(db, "attendance.sheet.submitted", "attendance_sheet", sheet.id, { estateId: sheet.estateId, businessDate });
  return { kind: "accepted", entityId: sheet.id, version: after.version };
}

export function getSheet(ctx: TenantContext, estateId: string, businessDate: string) {
  ctx.require("attendance.read", estateId);
  getEstate(ctx.db, estateId);
  const sheet = sheetFor(ctx.db, ctx, estateId, businessDate, false);
  const records = sheet ? ctx.db.select().from(attendanceRecords).where(eq(attendanceRecords.sheetId, sheet.id)).all() : [];
  // Each day starts from the previous recorded day's field and job (process text, OC-1).
  const previous = ctx.db
    .select()
    .from(attendanceSheets)
    .where(and(eq(attendanceSheets.estateId, estateId), lt(attendanceSheets.businessDate, businessDate)))
    .orderBy(desc(attendanceSheets.businessDate))
    .limit(1)
    .get();
  const prefill = previous
    ? ctx.db
        .select({ workerId: attendanceRecords.workerId, fieldId: attendanceRecords.fieldId, jobTypeId: attendanceRecords.jobTypeId, dayFraction: attendanceRecords.dayFraction })
        .from(attendanceRecords)
        .where(eq(attendanceRecords.sheetId, previous.id))
        .all()
        .filter((r) => r.fieldId && r.jobTypeId)
    : [];
  const conflicts = ctx.db
    .select()
    .from(syncConflicts)
    .where(and(eq(syncConflicts.estateId, estateId), eq(syncConflicts.state, "OPEN")))
    .all()
    .filter((c) => JSON.parse(c.serverJson).businessDate === businessDate);
  return {
    sheet: sheet ?? { id: null, estateId, businessDate, state: "DRAFT" as SheetState, version: 0 },
    records,
    prefill: { fromDate: previous?.businessDate ?? null, assignments: prefill },
    statuses: enabledStatuses(ctx.db),
    approvalRequired: setting(ctx.db, "attendance.approval.required"),
    openConflicts: conflicts.length,
  };
}

export function sheetAction(ctx: TenantContext, estateId: string, businessDate: string, action: "approve" | "return", reason?: string) {
  ctx.require("attendance.approve", estateId);
  return ctx.tx((db) => {
    const sheet = assertFound(sheetFor(db, ctx, estateId, businessDate, false), "Attendance sheet");
    let state: SheetState;
    try {
      state = transitionSheet(sheet.state, action, reason);
    } catch (e) {
      const err = e as { code: string; message: string };
      throw new AppError(409, err.code, err.message);
    }
    const open = db
      .select()
      .from(syncConflicts)
      .where(and(eq(syncConflicts.estateId, estateId), eq(syncConflicts.state, "OPEN")))
      .all()
      .filter((c) => JSON.parse(c.serverJson).businessDate === businessDate);
    if (action === "approve" && open.length) throw new AppError(409, "CONFLICTS_OPEN", "Resolve the conflicting entries for this day first");
    const now = ctx.nowIso();
    const after = {
      ...sheet,
      state,
      version: sheet.version + 1,
      updatedAt: now,
      ...(action === "approve" ? { approvedAt: now, approvedBy: ctx.scope.userId } : { returnedReason: reason ?? null, submittedAt: null, submittedBy: null }),
    };
    db.update(attendanceSheets).set(after).where(eq(attendanceSheets.id, sheet.id)).run();
    ctx.audit(db, { action: `attendance.sheet.${action}`, entityType: "attendance_sheet", entityId: sheet.id, estateId, reason: reason ?? null, before: sheet, after });
    ctx.emit(db, `attendance.sheet.${action === "approve" ? "approved" : "returned"}`, "attendance_sheet", sheet.id, { estateId, businessDate });
    return after;
  });
}

/** Change a record after submission. Append-only: the old version stays in record_revisions. */
export function correctRecord(
  ctx: TenantContext,
  recordId: string,
  input: { statusCode: string; dayFraction?: "FULL" | "HALF" | null; fieldId?: string | null; jobTypeId?: string | null; remarks?: string | null; reason: string; baseVersion: number },
) {
  return ctx.tx((db) => {
    const before = assertFound(db.select().from(attendanceRecords).where(eq(attendanceRecords.id, recordId)).get(), "Attendance record");
    ctx.require("attendance.correct", before.estateId);
    if (before.version !== input.baseVersion) throw staleVersion();
    const normalized = validateRecord(db, before.estateId, input);
    const after = { ...before, ...normalized, version: before.version + 1, receivedAt: ctx.nowIso() };
    db.update(attendanceRecords).set(after).where(eq(attendanceRecords.id, recordId)).run();
    ctx.revision(db, "attendance_record", recordId, after.version, after, "correct", input.reason, null);
    ctx.audit(db, { action: "attendance.record.correct", entityType: "attendance_record", entityId: recordId, estateId: before.estateId, reason: input.reason, before, after });
    ctx.emit(db, "attendance.record.corrected", "attendance_record", recordId, { estateId: before.estateId, businessDate: before.businessDate });
    return after;
  });
}

export function resolveAttendanceConflict(ctx: TenantContext, conflictId: string, keep: "server" | "incoming", reason: string) {
  return ctx.tx((db) => {
    const c = assertFound(db.select().from(syncConflicts).where(eq(syncConflicts.id, conflictId)).get(), "Conflict");
    ctx.require("conflicts.resolve", c.estateId);
    if (c.state !== "OPEN") throw new AppError(409, "CONFLICT_CLOSED", "This conflict was already resolved");
    const server = assertFound(db.select().from(attendanceRecords).where(eq(attendanceRecords.id, c.serverEntityId)).get(), "Attendance record");
    let result = server;
    if (keep === "incoming") {
      const incoming = JSON.parse(c.incomingJson) as AttendanceRecordPayload & { capturedAt: string };
      const normalized = validateRecord(db, server.estateId, incoming);
      result = { ...server, ...normalized, capturedBy: c.capturedBy, deviceId: c.deviceId, capturedAt: incoming.capturedAt, receivedAt: ctx.nowIso(), version: server.version + 1 };
      db.update(attendanceRecords).set(result).where(eq(attendanceRecords.id, server.id)).run();
      ctx.revision(db, "attendance_record", server.id, result.version, result, "conflict-resolve", reason, c.mutationId);
    }
    db.update(syncConflicts).set({ state: "RESOLVED", kept: keep, reason, resolvedBy: ctx.scope.userId, resolvedAt: ctx.nowIso() }).where(eq(syncConflicts.id, conflictId)).run();
    ctx.audit(db, {
      action: "sync.conflict.resolve",
      entityType: "attendance_record",
      entityId: server.id,
      estateId: c.estateId,
      reason,
      before: { server: JSON.parse(c.serverJson), incoming: JSON.parse(c.incomingJson) },
      after: { kept: keep, record: result },
    });
    return { conflictId, kept: keep, record: result };
  });
}

export function listConflicts(ctx: TenantContext, estateId: string) {
  ctx.require("attendance.read", estateId);
  getEstate(ctx.db, estateId);
  return ctx.db
    .select()
    .from(syncConflicts)
    .where(and(eq(syncConflicts.estateId, estateId), eq(syncConflicts.state, "OPEN")))
    .all()
    .map((c) => ({ ...c, incoming: JSON.parse(c.incomingJson), server: JSON.parse(c.serverJson) }));
}
