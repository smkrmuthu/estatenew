import type { estateInput, fieldInput, jobTypeInput, logKindInput, varietyInput, workerInput } from "@cemms/contracts";
import { uuidv7 } from "@cemms/domain";
import { and, eq, inArray } from "drizzle-orm";
import type { z } from "zod";
import { AppError } from "../../core/errors";
import { assertFound, type Db, staleVersion, type TenantContext } from "../context";
import { estates, fields, fieldVarieties, jobTypes, logKinds, varieties, workers } from "../schema";
import { setting } from "./settings";

const uniqueViolation = (e: unknown) => e instanceof Error && /UNIQUE constraint failed/i.test(e.message);

function audited(ctx: TenantContext) {
  return { now: ctx.nowIso(), by: ctx.scope.userId };
}

export function listEstates(ctx: TenantContext) {
  const allowed = ctx.estates("estate.read");
  const rows = ctx.db.select().from(estates).all();
  return allowed === "ALL" ? rows : rows.filter((r) => allowed.includes(r.id));
}

export function getEstate(db: Db, estateId: string) {
  return assertFound(db.select().from(estates).where(eq(estates.id, estateId)).get(), "Estate");
}

export function createEstate(ctx: TenantContext, input: z.infer<typeof estateInput>) {
  ctx.require("masters.write", null);
  const { now, by } = audited(ctx);
  const row = {
    id: uuidv7(),
    tenantId: ctx.scope.tenantId,
    code: input.code,
    name: input.name,
    timeZone: input.timeZone ?? setting(ctx.db, "estate.timeZone"),
    active: true,
    version: 1,
    createdAt: now,
    createdBy: by,
    updatedAt: now,
    updatedBy: by,
  };
  try {
    return ctx.tx((db) => {
      db.insert(estates).values(row).run();
      ctx.audit(db, { action: "estate.create", entityType: "estate", entityId: row.id, estateId: row.id, after: row });
      return row;
    });
  } catch (e) {
    if (uniqueViolation(e)) throw new AppError(409, "CODE_TAKEN", "An estate with this code already exists", { code: "Already used" });
    throw e;
  }
}

export interface ReferenceData {
  estates: (typeof estates.$inferSelect)[];
  fields: (Omit<typeof fields.$inferSelect, "cropsJson"> & { crops: string[]; varietyIds: string[] })[];
  varieties: (typeof varieties.$inferSelect)[];
  jobTypes: (typeof jobTypes.$inferSelect)[];
  workers: (typeof workers.$inferSelect)[];
  logKinds: (typeof logKinds.$inferSelect)[];
}

/** Master data for the estates the user can read; also the device bootstrap payload. */
export function referenceData(ctx: TenantContext, includeInactive = false): ReferenceData {
  const allowed = ctx.estates("masters.read");
  const estateRows = listEstates(ctx).filter((e) => allowed === "ALL" || allowed.includes(e.id));
  const ids = estateRows.map((e) => e.id);
  if (ids.length === 0) return { estates: [], fields: [], varieties: [], jobTypes: [], workers: [], logKinds: [] };
  const fv = ctx.db.select().from(fieldVarieties).all();
  const keep = <T extends { active: boolean }>(r: T) => includeInactive || r.active;
  return {
    estates: estateRows,
    fields: ctx.db
      .select()
      .from(fields)
      .where(inArray(fields.estateId, ids))
      .all()
      .filter(keep)
      .map(({ cropsJson, ...f }) => ({ ...f, crops: JSON.parse(cropsJson) as string[], varietyIds: fv.filter((x) => x.fieldId === f.id).map((x) => x.varietyId) })),
    varieties: ctx.db.select().from(varieties).all().filter(keep),
    jobTypes: ctx.db.select().from(jobTypes).all().filter(keep),
    workers: ctx.db.select().from(workers).where(inArray(workers.estateId, ids)).all().filter(keep),
    logKinds: ctx.db.select().from(logKinds).all().filter(keep),
  };
}

export function upsertField(ctx: TenantContext, input: z.infer<typeof fieldInput>, id?: string, baseVersion?: number) {
  ctx.require("masters.write", input.estateId);
  getEstate(ctx.db, input.estateId);
  const { now, by } = audited(ctx);
  const enabledCrops = setting(ctx.db, "crops.enabled");
  if (input.crops.some((c) => !enabledCrops.includes(c))) throw new AppError(422, "CROP_NOT_ENABLED", "This crop is not switched on", { crops: "Crop not enabled" });
  const vs = input.varietyIds.length ? ctx.db.select().from(varieties).where(inArray(varieties.id, input.varietyIds)).all() : [];
  if (vs.length !== input.varietyIds.length) throw new AppError(422, "VARIETY_UNKNOWN", "A variety was not found", { varietyIds: "Unknown variety" });
  try {
    return ctx.tx((db) => {
      if (id) {
        const before = assertFound(db.select().from(fields).where(eq(fields.id, id)).get(), "Field");
        if (before.estateId !== input.estateId) throw new AppError(422, "ESTATE_CHANGE", "A field cannot move to another estate");
        if (baseVersion !== undefined && before.version !== baseVersion) throw staleVersion();
        const after = {
          ...before,
          code: input.code,
          name: input.name,
          areaCentiAcres: input.areaCentiAcres ?? null,
          cropsJson: JSON.stringify(input.crops),
          active: input.active,
          version: before.version + 1,
          updatedAt: now,
          updatedBy: by,
        };
        db.update(fields).set(after).where(eq(fields.id, id)).run();
        db.delete(fieldVarieties).where(eq(fieldVarieties.fieldId, id)).run();
        for (const v of input.varietyIds) db.insert(fieldVarieties).values({ fieldId: id, varietyId: v }).run();
        ctx.audit(db, { action: "field.update", entityType: "field", entityId: id, estateId: input.estateId, before, after: { ...after, varietyIds: input.varietyIds } });
        return after;
      }
      const row = {
        id: uuidv7(),
        tenantId: ctx.scope.tenantId,
        estateId: input.estateId,
        code: input.code,
        name: input.name,
        areaCentiAcres: input.areaCentiAcres ?? null,
        cropsJson: JSON.stringify(input.crops),
        active: input.active,
        version: 1,
        createdAt: now,
        createdBy: by,
        updatedAt: now,
        updatedBy: by,
      };
      db.insert(fields).values(row).run();
      for (const v of input.varietyIds) db.insert(fieldVarieties).values({ fieldId: row.id, varietyId: v }).run();
      ctx.audit(db, { action: "field.create", entityType: "field", entityId: row.id, estateId: row.estateId, after: { ...row, varietyIds: input.varietyIds } });
      return row;
    });
  } catch (e) {
    if (uniqueViolation(e)) throw new AppError(409, "CODE_TAKEN", "This estate already has a field with this code", { code: "Already used" });
    throw e;
  }
}

type SimpleTable = typeof varieties | typeof jobTypes;

function upsertSimple<T extends SimpleTable>(ctx: TenantContext, table: T, entityType: string, values: Record<string, unknown>, id?: string, baseVersion?: number) {
  ctx.require("masters.write", null);
  const { now, by } = audited(ctx);
  try {
    return ctx.tx((db) => {
      if (id) {
        const before = assertFound(db.select().from(table).where(eq(table.id, id)).get(), entityType);
        if (baseVersion !== undefined && before.version !== baseVersion) throw staleVersion();
        const after = { ...before, ...values, version: before.version + 1, updatedAt: now, updatedBy: by };
        db.update(table)
          .set(after as never)
          .where(eq(table.id, id))
          .run();
        ctx.audit(db, { action: `${entityType}.update`, entityType, entityId: id, estateId: null, before, after });
        return after;
      }
      const row = { id: uuidv7(), tenantId: ctx.scope.tenantId, ...values, version: 1, createdAt: now, createdBy: by, updatedAt: now, updatedBy: by };
      db.insert(table)
        .values(row as never)
        .run();
      ctx.audit(db, { action: `${entityType}.create`, entityType, entityId: row.id, estateId: null, after: row });
      return row;
    });
  } catch (e) {
    if (uniqueViolation(e)) throw new AppError(409, "CODE_TAKEN", "This code is already used", { code: "Already used" });
    throw e;
  }
}

export const upsertVariety = (ctx: TenantContext, input: z.infer<typeof varietyInput>, id?: string, v?: number) => upsertSimple(ctx, varieties, "variety", input, id, v);
export const upsertJobType = (ctx: TenantContext, input: z.infer<typeof jobTypeInput>, id?: string, v?: number) => upsertSimple(ctx, jobTypes, "job_type", input, id, v);

export function upsertWorker(ctx: TenantContext, input: z.infer<typeof workerInput>, id?: string, baseVersion?: number) {
  ctx.require("masters.write", input.estateId);
  getEstate(ctx.db, input.estateId);
  const { now, by } = audited(ctx);
  try {
    return ctx.tx((db) => {
      if (id) {
        const before = assertFound(db.select().from(workers).where(eq(workers.id, id)).get(), "Worker");
        if (!ctx.can("masters.write", before.estateId)) throw new AppError(403, "FORBIDDEN", "You do not have permission to do this");
        if (baseVersion !== undefined && before.version !== baseVersion) throw staleVersion();
        const after = { ...before, ...input, version: before.version + 1, updatedAt: now, updatedBy: by };
        db.update(workers).set(after).where(eq(workers.id, id)).run();
        ctx.audit(db, { action: "worker.update", entityType: "worker", entityId: id, estateId: input.estateId, before, after });
        return after;
      }
      const row = { id: uuidv7(), tenantId: ctx.scope.tenantId, ...input, version: 1, createdAt: now, createdBy: by, updatedAt: now, updatedBy: by };
      db.insert(workers).values(row).run();
      ctx.audit(db, { action: "worker.create", entityType: "worker", entityId: row.id, estateId: row.estateId, after: row });
      return row;
    });
  } catch (e) {
    if (uniqueViolation(e)) throw new AppError(409, "CODE_TAKEN", "This employee code is already used", { employeeCode: "Already used" });
    throw e;
  }
}

export function upsertLogKind(ctx: TenantContext, input: z.infer<typeof logKindInput>, id?: string, baseVersion?: number) {
  ctx.require("settings.manage", null);
  if (input.minScaled !== null && input.maxScaled !== null && input.minScaled > input.maxScaled) throw new AppError(422, "RANGE", "Minimum is above maximum", { minScaled: "Above maximum" });
  const { now, by } = audited(ctx);
  try {
    return ctx.tx((db) => {
      if (id) {
        const before = assertFound(db.select().from(logKinds).where(eq(logKinds.id, id)).get(), "Log kind");
        if (baseVersion !== undefined && before.version !== baseVersion) throw staleVersion();
        if (before.decimals !== input.decimals || before.valueType !== input.valueType) {
          throw new AppError(422, "KIND_SHAPE_LOCKED", "Value type and decimals cannot change once set; create a new kind instead");
        }
        const after = { ...before, ...input, version: before.version + 1, updatedAt: now, updatedBy: by };
        db.update(logKinds).set(after).where(eq(logKinds.id, id)).run();
        ctx.audit(db, { action: "log_kind.update", entityType: "log_kind", entityId: id, estateId: null, before, after });
        return after;
      }
      const row = { id: uuidv7(), tenantId: ctx.scope.tenantId, ...input, basis: "tenant-choice", version: 1, createdAt: now, createdBy: by, updatedAt: now, updatedBy: by };
      db.insert(logKinds).values(row).run();
      ctx.audit(db, { action: "log_kind.create", entityType: "log_kind", entityId: row.id, estateId: null, after: row });
      return row;
    });
  } catch (e) {
    if (uniqueViolation(e)) throw new AppError(409, "CODE_TAKEN", "This code is already used", { code: "Already used" });
    throw e;
  }
}

export function activeWorker(db: Db, workerId: string, estateId: string) {
  const w = db
    .select()
    .from(workers)
    .where(and(eq(workers.id, workerId), eq(workers.estateId, estateId)))
    .get();
  if (!w?.active) throw new AppError(422, "WORKER_UNKNOWN", "This worker is not active on this estate", { workerId: "Unknown worker" });
  return w;
}

export function activeField(db: Db, fieldId: string, estateId: string) {
  const f = db
    .select()
    .from(fields)
    .where(and(eq(fields.id, fieldId), eq(fields.estateId, estateId)))
    .get();
  if (!f?.active) throw new AppError(422, "FIELD_UNKNOWN", "This field is not active on this estate", { fieldId: "Unknown field" });
  return { ...f, crops: JSON.parse(f.cropsJson) as string[] };
}

export function activeJobType(db: Db, jobTypeId: string) {
  const j = db.select().from(jobTypes).where(eq(jobTypes.id, jobTypeId)).get();
  if (!j?.active) throw new AppError(422, "JOB_UNKNOWN", "This job is not in use", { jobTypeId: "Unknown job" });
  return j;
}
