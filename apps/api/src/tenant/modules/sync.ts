import { MUTATION_PAYLOADS, type Mutation, type MutationKind } from "@cemms/contracts";
import { canonicalJson, type SyncItemResult, sha256Hex } from "@cemms/domain";
import { and, eq } from "drizzle-orm";
import { AppError, fieldErrorsFromZod } from "../../core/errors";
import { log } from "../../core/log";
import type { Db, TenantContext } from "../context";
import { deviceStatus, syncMutations } from "../schema";
import { type ApplyMeta, type ApplyOutcome, applyAttendanceRecord, applyAttendanceUnmark, applySheetSubmit } from "./attendance";
import { applyDailyLogCreate, applyDailyLogVoid } from "./dailylog";
import { applyMusterCreate, applyMusterVoid } from "./muster";

type Handler = (ctx: TenantContext, db: Db, meta: ApplyMeta, payload: never) => ApplyOutcome;

const HANDLERS: Record<MutationKind, Handler> = {
  "attendance_record:upsert": applyAttendanceRecord as Handler,
  "attendance_record:void": ((ctx, db, meta, p: { reason: string }) => applyAttendanceUnmark(ctx, db, meta, p.reason)) as Handler,
  "attendance_sheet:submit": ((ctx, db, meta, p: { businessDate: string; shift?: "DAY" | "NIGHT" }) => applySheetSubmit(ctx, db, meta, p.businessDate, p.shift)) as Handler,
  "muster_entry:create": applyMusterCreate as Handler,
  "muster_entry:void": ((ctx, db, meta, p: { reason: string }) => applyMusterVoid(ctx, db, meta, p.reason)) as Handler,
  "dailylog_entry:create": applyDailyLogCreate as Handler,
  "dailylog_entry:void": ((ctx, db, meta, p: { reason: string }) => applyDailyLogVoid(ctx, db, meta, p.reason)) as Handler,
};

function store(db: Db, ctx: TenantContext, m: Mutation, result: SyncItemResult) {
  db.insert(syncMutations)
    .values({
      deviceId: m.deviceId,
      mutationId: m.mutationId,
      entityType: m.entityType,
      entityId: m.entityId,
      payloadHash: m.payloadHash,
      resultJson: JSON.stringify(result),
      userId: ctx.scope.userId,
      receivedAt: ctx.nowIso(),
    })
    .run();
}

/**
 * Apply a batch of device mutations in order. Each mutation commits (or fails) on its own,
 * together with its outbox event and its stored acknowledgement, so a retry of the same
 * mutation returns the same answer.
 */
export async function pushMutations(ctx: TenantContext, input: { deviceId: string; pendingCount: number; mutations: Mutation[] }) {
  if (input.deviceId !== ctx.scope.deviceId) throw new AppError(403, "DEVICE_MISMATCH", "This session belongs to another device");
  const results: SyncItemResult[] = [];
  const touchedEstates = new Set<string>();
  for (const m of input.mutations) {
    const serverTime = ctx.nowIso();
    const base = { mutationId: m.mutationId, entityId: m.entityId, serverTime };
    const prior = ctx.db
      .select()
      .from(syncMutations)
      .where(and(eq(syncMutations.deviceId, m.deviceId), eq(syncMutations.mutationId, m.mutationId)))
      .get();
    if (prior) {
      if (prior.payloadHash !== m.payloadHash)
        results.push({ ...base, status: "rejected", version: null, errorCode: "MUTATION_REUSED", message: "This change id was already used for different data" });
      else results.push({ ...(JSON.parse(prior.resultJson) as SyncItemResult), duplicate: true });
      continue;
    }
    if (m.deviceId !== ctx.scope.deviceId) {
      results.push({ ...base, status: "rejected", version: null, errorCode: "DEVICE_MISMATCH", message: "This change came from another device" });
      continue;
    }
    if ((await sha256Hex(canonicalJson(m.payload))) !== m.payloadHash) {
      results.push({ ...base, status: "rejected", version: null, errorCode: "HASH_MISMATCH", message: "The change was damaged on the way. It will be sent again.", retryable: true });
      continue;
    }
    const kind = `${m.entityType}:${m.op}` as MutationKind;
    const schema = MUTATION_PAYLOADS[kind];
    const handler = HANDLERS[kind];
    let result: SyncItemResult;
    if (!schema || !handler) {
      result = { ...base, status: "rejected", version: null, errorCode: "UNSUPPORTED", message: "This kind of change is not supported" };
    } else {
      const parsed = schema.safeParse(m.payload);
      if (!parsed.success) {
        result = { ...base, status: "rejected", version: null, errorCode: "VALIDATION", message: "Some values are not valid", fieldErrors: fieldErrorsFromZod(parsed.error) };
      } else {
        try {
          result = ctx.tx((db) => {
            const outcome = handler(ctx, db, { mutationId: m.mutationId, entityId: m.entityId, estateId: m.estateId, capturedAt: m.capturedAt, baseVersion: m.baseVersion }, parsed.data as never);
            const r: SyncItemResult =
              outcome.kind === "accepted"
                ? { ...base, status: "accepted", entityId: outcome.entityId, version: outcome.version }
                : { ...base, status: "conflict", entityId: outcome.entityId, version: outcome.version, conflictId: outcome.conflictId, message: outcome.message };
            store(db, ctx, m, r);
            return r;
          });
          touchedEstates.add(m.estateId);
        } catch (e) {
          if (!(e instanceof AppError)) {
            log("error", "sync.apply.failed", { requestId: ctx.scope.requestId, tenantId: ctx.scope.tenantId, mutationId: m.mutationId, kind, error: (e as Error).message });
            results.push({ ...base, status: "rejected", version: null, errorCode: "SERVER_ERROR", message: "The server could not save this yet. It will be sent again.", retryable: true });
            continue;
          }
          result = { ...base, status: "rejected", version: null, errorCode: e.code, message: e.message, ...(e.fieldErrors ? { fieldErrors: e.fieldErrors } : {}) };
        }
      }
    }
    if (result.status === "rejected") ctx.tx((db) => store(db, ctx, m, result));
    results.push(result);
  }
  ctx.tx((db) => {
    const row = { deviceId: input.deviceId, userId: ctx.scope.userId, estateIdsJson: JSON.stringify([...touchedEstates]), pendingCount: input.pendingCount, lastSyncAt: ctx.nowIso() };
    const prev = db.select().from(deviceStatus).where(eq(deviceStatus.deviceId, input.deviceId)).get();
    if (prev) {
      const estates = [...new Set([...(JSON.parse(prev.estateIdsJson) as string[]), ...touchedEstates])];
      db.update(deviceStatus)
        .set({ ...row, estateIdsJson: JSON.stringify(estates) })
        .where(eq(deviceStatus.deviceId, input.deviceId))
        .run();
    } else db.insert(deviceStatus).values(row).run();
  });
  return { serverTime: ctx.nowIso(), results };
}
