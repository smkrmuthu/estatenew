import type { estateInput, fieldInput, jobTypeInput, logKindInput, varietyInput, workerInput } from "@cemms/contracts";
import { uuidv7 } from "@cemms/domain";
import { and, eq, inArray } from "drizzle-orm";
import type { z } from "zod";
import { AppError } from "../../core/errors";
import { assertFound, type Db, staleVersion, type TenantContext } from "../context";
import { attendanceRecords, estates, fieldSubdivisions, fields, fieldVarieties, jobTypes, logKinds, musterEntries, varieties, workerEstates, workers } from "../schema";
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
  fields: (Omit<typeof fields.$inferSelect, "cropsJson" | "expectedCherryG"> & {
    crops: string[];
    varietyIds: string[];
    expectedCherryKg: number | null;
    subdivisions: { id: string; label: string; landUse: string; varietyId: string | null; areaCentiAcres: number | null }[];
  })[];
  varieties: (typeof varieties.$inferSelect)[];
  jobTypes: (typeof jobTypes.$inferSelect)[];
  workers: (typeof workers.$inferSelect & { estateIds: string[] })[];
  logKinds: (typeof logKinds.$inferSelect)[];
}

/** Master data for the estates the user can read; also the device bootstrap payload. */
export function referenceData(ctx: TenantContext, includeInactive = false): ReferenceData {
  const allowed = ctx.estates("masters.read");
  const estateRows = listEstates(ctx).filter((e) => allowed === "ALL" || allowed.includes(e.id));
  const ids = estateRows.map((e) => e.id);
  if (ids.length === 0) return { estates: [], fields: [], varieties: [], jobTypes: [], workers: [], logKinds: [] };
  const fv = ctx.db.select().from(fieldVarieties).all();
  const subs = ctx.db.select().from(fieldSubdivisions).all();
  const keep = <T extends { active: boolean }>(r: T) => includeInactive || r.active;
  const allotted = ctx.db.select().from(workerEstates).all();
  return {
    estates: estateRows,
    fields: ctx.db
      .select()
      .from(fields)
      .where(inArray(fields.estateId, ids))
      .all()
      .filter(keep)
      .map(({ cropsJson, expectedCherryG, ...f }) => ({
        ...f,
        crops: JSON.parse(cropsJson) as string[],
        varietyIds: fv.filter((x) => x.fieldId === f.id).map((x) => x.varietyId),
        expectedCherryKg: expectedCherryG === null ? null : expectedCherryG / 1000,
        subdivisions: subs
          .filter((s) => s.fieldId === f.id)
          .sort((a, b) => a.label.localeCompare(b.label))
          .map((s) => ({ id: s.id, label: s.label, landUse: s.landUse, varietyId: s.varietyId, areaCentiAcres: s.areaCentiAcres })),
      })),
    varieties: ctx.db.select().from(varieties).all().filter(keep),
    jobTypes: ctx.db.select().from(jobTypes).all().filter(keep),
    workers: ctx.db
      .select()
      .from(workers)
      .all()
      .filter(keep)
      .flatMap((w) => {
        const estateIds = allotted.filter((a) => a.workerId === w.id && ids.includes(a.estateId)).map((a) => a.estateId);
        return estateIds.length ? [{ ...w, estateIds }] : [];
      }),
    logKinds: ctx.db.select().from(logKinds).all().filter(keep),
  };
}

/** The next free field code for an estate, like GLZ-07, allocated inside the insert's transaction. */
function nextFieldCode(db: Db, estateId: string): string {
  const estate = assertFound(db.select().from(estates).where(eq(estates.id, estateId)).get(), "Estate");
  const prefix = `${estate.code.toUpperCase().replace(/[^A-Z0-9]/g, "")}-`;
  const used = db
    .select({ code: fields.code })
    .from(fields)
    .where(eq(fields.estateId, estateId))
    .all()
    .flatMap((f) => (f.code.toUpperCase().startsWith(prefix) && /^\d+$/.test(f.code.slice(prefix.length)) ? [Number(f.code.slice(prefix.length))] : []));
  return `${prefix}${String(Math.max(0, ...used) + 1).padStart(2, "0")}`;
}

export function upsertField(ctx: TenantContext, input: z.infer<typeof fieldInput>, id?: string, baseVersion?: number) {
  ctx.require("masters.write", input.estateId);
  getEstate(ctx.db, input.estateId);
  const { now, by } = audited(ctx);
  const enabledCrops = setting(ctx.db, "crops.enabled");
  if (input.crops.some((c) => !enabledCrops.includes(c))) throw new AppError(422, "CROP_NOT_ENABLED", "This crop is not switched on", { crops: "Crop not enabled" });
  const subdivisions = input.subdivisions ?? null;
  if (subdivisions && subdivisions.length > 0) {
    if (!input.areaCentiAcres) throw new AppError(422, "SUBDIVISION_AREA", "Enter the total acres before adding subdivisions", { areaCentiAcres: "Required" });
    const total = subdivisions.reduce((s, x) => s + x.areaCentiAcres, 0);
    if (total !== input.areaCentiAcres) {
      throw new AppError(422, "SUBDIVISION_AREA", `Subdivisions add up to ${total / 100} acres, but the field is ${input.areaCentiAcres / 100} acres. Make them match.`, {
        subdivisions: "Acres do not match",
      });
    }
    if (subdivisions.some((s) => s.landUse === "BEARING" && !s.varietyId)) throw new AppError(422, "SUBDIVISION_VARIETY", "Bearing subdivisions need a variety", { subdivisions: "Variety needed" });
  }
  // With subdivisions, the field's varieties are the ones its subdivisions carry.
  const varietyIds = subdivisions && subdivisions.length > 0 ? [...new Set(subdivisions.flatMap((s) => (s.varietyId ? [s.varietyId] : [])))] : input.varietyIds;
  const vs = varietyIds.length ? ctx.db.select().from(varieties).where(inArray(varieties.id, varietyIds)).all() : [];
  if (vs.length !== varietyIds.length) throw new AppError(422, "VARIETY_UNKNOWN", "A variety was not found", { varietyIds: "Unknown variety" });
  const writeSubdivisions = (db: Db, fieldId: string) => {
    if (!subdivisions) return;
    db.delete(fieldSubdivisions).where(eq(fieldSubdivisions.fieldId, fieldId)).run();
    for (const [i, s] of subdivisions.entries()) {
      db.insert(fieldSubdivisions)
        .values({ id: uuidv7(), tenantId: ctx.scope.tenantId, fieldId, label: String.fromCharCode(65 + i), landUse: s.landUse, varietyId: s.varietyId ?? null, areaCentiAcres: s.areaCentiAcres })
        .run();
    }
  };
  const extra = {
    elevationM: input.elevationM ?? null,
    expectedCherryG: input.expectedCherryKg == null ? null : input.expectedCherryKg * 1000,
  };
  try {
    return ctx.tx((db) => {
      if (id) {
        const before = assertFound(db.select().from(fields).where(eq(fields.id, id)).get(), "Field");
        if (before.estateId !== input.estateId) throw new AppError(422, "ESTATE_CHANGE", "A field cannot move to another estate");
        if (baseVersion !== undefined && before.version !== baseVersion) throw staleVersion();
        const after = {
          ...before,
          code: input.code ?? before.code,
          name: input.name,
          areaCentiAcres: input.areaCentiAcres ?? null,
          ...extra,
          cropsJson: JSON.stringify(input.crops),
          active: input.active,
          version: before.version + 1,
          updatedAt: now,
          updatedBy: by,
        };
        db.update(fields).set(after).where(eq(fields.id, id)).run();
        db.delete(fieldVarieties).where(eq(fieldVarieties.fieldId, id)).run();
        for (const v of varietyIds) db.insert(fieldVarieties).values({ fieldId: id, varietyId: v }).run();
        writeSubdivisions(db, id);
        ctx.audit(db, { action: "field.update", entityType: "field", entityId: id, estateId: input.estateId, before, after: { ...after, varietyIds, subdivisions } });
        return after;
      }
      const row = {
        id: uuidv7(),
        tenantId: ctx.scope.tenantId,
        estateId: input.estateId,
        code: input.code ?? nextFieldCode(db, input.estateId),
        name: input.name,
        areaCentiAcres: input.areaCentiAcres ?? null,
        ...extra,
        cropsJson: JSON.stringify(input.crops),
        active: input.active,
        version: 1,
        createdAt: now,
        createdBy: by,
        updatedAt: now,
        updatedBy: by,
      };
      db.insert(fields).values(row).run();
      for (const v of varietyIds) db.insert(fieldVarieties).values({ fieldId: row.id, varietyId: v }).run();
      writeSubdivisions(db, row.id);
      ctx.audit(db, { action: "field.create", entityType: "field", entityId: row.id, estateId: row.estateId, after: { ...row, varietyIds, subdivisions } });
      return row;
    });
  } catch (e) {
    if (uniqueViolation(e)) throw new AppError(409, "CODE_TAKEN", "This estate already has a field with this code", { code: "Already used" });
    throw e;
  }
}

type SimpleTable = typeof varieties | typeof jobTypes;

function upsertSimple<T extends SimpleTable>(ctx: TenantContext, table: T, entityType: string, values: Record<string, unknown>, id?: string, baseVersion?: number) {
  ctx.requireAny("masters.write");
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

/** The next free code for an estate, like GLZ-007, allocated inside the same transaction as the insert. */
function nextEmployeeCode(db: Db, estateId: string): string {
  const estate = assertFound(db.select().from(estates).where(eq(estates.id, estateId)).get(), "Estate");
  const prefix = `${estate.code.toUpperCase().replace(/[^A-Z0-9]/g, "")}-`;
  const used = db
    .select({ code: workers.employeeCode })
    .from(workers)
    .all()
    .flatMap((w) => (w.code.toUpperCase().startsWith(prefix) && /^\d+$/.test(w.code.slice(prefix.length)) ? [Number(w.code.slice(prefix.length))] : []));
  return `${prefix}${String(Math.max(0, ...used) + 1).padStart(3, "0")}`;
}

export function upsertWorker(ctx: TenantContext, input: z.infer<typeof workerInput>, id?: string, baseVersion?: number) {
  const { estateIds: requested, ...fields } = input;
  const wanted = [...new Set(requested ?? [input.estateId])];
  for (const e of wanted) {
    ctx.require("masters.write", e);
    getEstate(ctx.db, e);
  }
  const { now, by } = audited(ctx);
  try {
    return ctx.tx((db) => {
      if (id) {
        const before = assertFound(db.select().from(workers).where(eq(workers.id, id)).get(), "Worker");
        if (!ctx.can("masters.write", before.estateId)) throw new AppError(403, "FORBIDDEN", "You do not have permission to do this");
        if (baseVersion !== undefined && before.version !== baseVersion) throw staleVersion();
        const was = workerEstateIds(db, id);
        // Estates this user cannot see keep their allotment; only the estates they can manage are replaced.
        const readable = ctx.estates("masters.read");
        const hidden = was.filter((e) => readable !== "ALL" && !readable.includes(e));
        const now_ = [...new Set([...wanted, ...hidden])];
        const home = now_.includes(before.estateId) ? before.estateId : (wanted[0] ?? before.estateId);
        for (const e of was.filter((x) => !now_.includes(x))) ctx.require("masters.write", e);
        const after = { ...before, ...fields, estateId: home, version: before.version + 1, updatedAt: now, updatedBy: by };
        db.update(workers).set(after).where(eq(workers.id, id)).run();
        setWorkerEstates(db, ctx.scope.tenantId, id, now_);
        ctx.audit(db, { action: "worker.update", entityType: "worker", entityId: id, estateId: home, before: { ...before, estateIds: was }, after: { ...after, estateIds: now_ } });
        return { ...after, estateIds: now_.sort() };
      }
      const home = wanted.includes(input.estateId) ? input.estateId : (wanted[0] ?? input.estateId);
      const row = {
        id: uuidv7(),
        tenantId: ctx.scope.tenantId,
        ...fields,
        estateId: home,
        employeeCode: input.employeeCode ?? nextEmployeeCode(db, home),
        version: 1,
        createdAt: now,
        createdBy: by,
        updatedAt: now,
        updatedBy: by,
      };
      db.insert(workers).values(row).run();
      setWorkerEstates(db, ctx.scope.tenantId, row.id, wanted);
      ctx.audit(db, { action: "worker.create", entityType: "worker", entityId: row.id, estateId: row.estateId, after: { ...row, estateIds: wanted } });
      return { ...row, estateIds: wanted.sort() };
    });
  } catch (e) {
    if (uniqueViolation(e)) throw new AppError(409, "CODE_TAKEN", "This employee code is already used", { employeeCode: "Already used" });
    throw e;
  }
}

export function upsertLogKind(ctx: TenantContext, input: z.infer<typeof logKindInput>, id?: string, baseVersion?: number) {
  ctx.requireAny("dailylog.configure");
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
  const w = db.select().from(workers).where(eq(workers.id, workerId)).get();
  const here = w
    ? db
        .select()
        .from(workerEstates)
        .where(and(eq(workerEstates.workerId, workerId), eq(workerEstates.estateId, estateId)))
        .get()
    : undefined;
  if (!w?.active || !here) throw new AppError(422, "WORKER_UNKNOWN", "This worker is not active on this estate", { workerId: "Unknown worker" });
  return w;
}

/** The ids of the workers allotted to an estate, for filtering reports and registers. */
export function workerIdsIn(db: Db, estateId: string) {
  return db.select({ id: workerEstates.workerId }).from(workerEstates).where(eq(workerEstates.estateId, estateId));
}

export function workerEstateIds(db: Db, workerId: string): string[] {
  return db
    .select()
    .from(workerEstates)
    .where(eq(workerEstates.workerId, workerId))
    .all()
    .map((x) => x.estateId)
    .sort();
}

/** Replace the estates a worker is allotted to. */
export function setWorkerEstates(db: Db, tenantId: string, workerId: string, estateIds: string[]) {
  db.delete(workerEstates).where(eq(workerEstates.workerId, workerId)).run();
  for (const estateId of new Set(estateIds)) db.insert(workerEstates).values({ workerId, estateId, tenantId }).run();
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

const usedMessage = (what: string) => `${what} has attendance or weigh-in records, so it cannot be deleted. Set it to Inactive instead; it then leaves the daily register but stays in the history.`;

/** Delete a worker that nothing refers to yet (for example sample data). Used workers are set Inactive instead. */
export function deleteWorker(ctx: TenantContext, id: string, reason: string) {
  const before = assertFound(ctx.db.select().from(workers).where(eq(workers.id, id)).get(), "Worker");
  ctx.require("masters.write", before.estateId);
  return ctx.tx((db) => {
    const used =
      db.select({ id: attendanceRecords.id }).from(attendanceRecords).where(eq(attendanceRecords.workerId, id)).limit(1).all().length +
      db.select({ id: musterEntries.id }).from(musterEntries).where(eq(musterEntries.workerId, id)).limit(1).all().length;
    if (used > 0) throw new AppError(409, "IN_USE", usedMessage(before.name));
    db.delete(workerEstates).where(eq(workerEstates.workerId, id)).run();
    db.delete(workers).where(eq(workers.id, id)).run();
    ctx.audit(db, { action: "worker.delete", entityType: "worker", entityId: id, estateId: before.estateId, reason, before });
    return { deleted: true, id };
  });
}

/** Delete a field (and its subdivisions) that nothing refers to yet. Used fields are set Inactive instead. */
export function deleteField(ctx: TenantContext, id: string, reason: string) {
  const before = assertFound(ctx.db.select().from(fields).where(eq(fields.id, id)).get(), "Field");
  ctx.require("masters.write", before.estateId);
  return ctx.tx((db) => {
    const used =
      db.select({ id: attendanceRecords.id }).from(attendanceRecords).where(eq(attendanceRecords.fieldId, id)).limit(1).all().length +
      db.select({ id: musterEntries.id }).from(musterEntries).where(eq(musterEntries.fieldId, id)).limit(1).all().length;
    if (used > 0) throw new AppError(409, "IN_USE", usedMessage(before.name));
    const subdivisions = db.select().from(fieldSubdivisions).where(eq(fieldSubdivisions.fieldId, id)).all();
    db.delete(fieldSubdivisions).where(eq(fieldSubdivisions.fieldId, id)).run();
    db.delete(fieldVarieties).where(eq(fieldVarieties.fieldId, id)).run();
    db.delete(fields).where(eq(fields.id, id)).run();
    ctx.audit(db, { action: "field.delete", entityType: "field", entityId: id, estateId: before.estateId, reason, before: { ...before, subdivisions } });
    return { deleted: true, id };
  });
}
