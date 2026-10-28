import { type CsvError, type ImportKind, parseImport, sha256Hex, uuidv7, type WorkerRow } from "@cemms/domain";
import { and, eq } from "drizzle-orm";
import { AppError } from "../../core/errors";
import type { Db, TenantContext } from "../context";
import { estates, fields, fieldVarieties, importRuns, jobTypes, varieties, workers } from "../schema";
import { setting } from "./settings";

interface PlannedRow {
  row: number;
  key: string;
  action: "create" | "update" | "unchanged";
  changes: string[];
}

export interface ImportPreview {
  kind: ImportKind;
  previewHash: string;
  totals: { rows: number; create: number; update: number; unchanged: number; errors: number };
  rows: PlannedRow[];
  errors: { row: number; column: string; message: string }[];
}

async function fileHash(kind: string, csv: string) {
  return sha256Hex(`${kind}\n${csv}`);
}

function parse(kind: ImportKind, csv: string) {
  try {
    return parseImport(kind, csv);
  } catch (e) {
    const err = e as CsvError;
    throw new AppError(err.code === "CSV_TOO_LARGE" ? 413 : 422, err.code ?? "CSV_MALFORMED", err.message);
  }
}

type Op = { row: number; key: string; action: PlannedRow["action"]; changes: string[]; apply: (db: Db) => void };

/** Resolve references and decide create / update / unchanged for each row. Pure read. */
function plan(ctx: TenantContext, kind: ImportKind, csv: string): { ops: Op[]; errors: ImportPreview["errors"] } {
  const parsed = parse(kind, csv);
  const errors = [...parsed.errors];
  const db = ctx.db;
  const now = ctx.nowIso();
  const by = ctx.scope.userId;
  const tenantId = ctx.scope.tenantId;
  const base = { version: 1, createdAt: now, createdBy: by, updatedAt: now, updatedBy: by };
  const estateByCode = new Map(
    db
      .select()
      .from(estates)
      .all()
      .map((e) => [e.code.toUpperCase(), e]),
  );
  const varietyByCode = new Map(
    db
      .select()
      .from(varieties)
      .all()
      .map((v) => [v.code.toUpperCase(), v]),
  );
  const ops: Op[] = [];
  const diff = (before: Record<string, unknown>, after: Record<string, unknown>) => Object.keys(after).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
  const estateFor = (row: number, code: string) => {
    const e = estateByCode.get(code.toUpperCase());
    if (!e) errors.push({ row, column: "estate_code", message: `No estate with code ${code}` });
    else if (!ctx.can("masters.import", e.id)) errors.push({ row, column: "estate_code", message: "You cannot import into this estate" });
    return e && ctx.can("masters.import", e.id) ? e : undefined;
  };

  for (const r of parsed.rows) {
    const v = r.value as unknown as Record<string, unknown>;
    switch (kind) {
      case "estates": {
        if (!ctx.can("masters.import", null)) {
          errors.push({ row: r.row, column: "code", message: "Only tenant-wide users can import estates" });
          continue;
        }
        const existing = estateByCode.get(r.key);
        const values = { code: v.code as string, name: v.name as string };
        if (!existing) {
          const row = { id: uuidv7(), tenantId, ...values, timeZone: setting(db, "estate.timeZone"), active: true, ...base };
          ops.push({ row: r.row, key: r.key, action: "create", changes: [], apply: (d) => d.insert(estates).values(row).run() });
        } else {
          const changes = diff(existing, values);
          ops.push({
            row: r.row,
            key: r.key,
            action: changes.length ? "update" : "unchanged",
            changes,
            apply: (d) =>
              d
                .update(estates)
                .set({ ...values, version: existing.version + 1, updatedAt: now, updatedBy: by })
                .where(eq(estates.id, existing.id))
                .run(),
          });
        }
        break;
      }
      case "varieties":
      case "job_types": {
        if (!ctx.can("masters.import", null)) {
          errors.push({ row: r.row, column: "code", message: "Only tenant-wide users can import this list" });
          continue;
        }
        const table = kind === "varieties" ? varieties : jobTypes;
        const existing = db
          .select()
          .from(table)
          .all()
          .find((x) => x.code.toUpperCase() === r.key);
        const values = kind === "varieties" ? { code: v.code as string, name: v.name as string, crop: v.crop as "COFFEE" | "PEPPER" } : { code: v.code as string, name: v.name as string };
        if (!existing) {
          const row = { id: uuidv7(), tenantId, ...values, active: true, ...base };
          ops.push({
            row: r.row,
            key: r.key,
            action: "create",
            changes: [],
            apply: (d) =>
              d
                .insert(table)
                .values(row as typeof table.$inferInsert)
                .run(),
          });
        } else {
          const changes = diff(existing, values);
          ops.push({
            row: r.row,
            key: r.key,
            action: changes.length ? "update" : "unchanged",
            changes,
            apply: (d) =>
              d
                .update(table)
                .set({ ...values, version: existing.version + 1, updatedAt: now, updatedBy: by })
                .where(eq(table.id, existing.id))
                .run(),
          });
        }
        break;
      }
      case "fields": {
        const estate = estateFor(r.row, v.estateCode as string);
        const varietyIds: string[] = [];
        for (const code of v.varietyCodes as string[]) {
          const vv = varietyByCode.get(code.toUpperCase());
          if (!vv) errors.push({ row: r.row, column: "varieties", message: `No variety with code ${code}` });
          else varietyIds.push(vv.id);
        }
        const enabled = setting(db, "crops.enabled");
        if ((v.crops as string[]).some((c) => !enabled.includes(c))) errors.push({ row: r.row, column: "crops", message: "Crop is not switched on" });
        if (!estate) continue;
        const existing = db
          .select()
          .from(fields)
          .where(and(eq(fields.estateId, estate.id), eq(fields.code, v.code as string)))
          .get();
        const values = { code: v.code as string, name: v.name as string, areaCentiAcres: v.areaCentiAcres as number | null, cropsJson: JSON.stringify(v.crops) };
        const setVarieties = (d: Db, fieldId: string) => {
          d.delete(fieldVarieties).where(eq(fieldVarieties.fieldId, fieldId)).run();
          for (const id of varietyIds) d.insert(fieldVarieties).values({ fieldId, varietyId: id }).run();
        };
        if (!existing) {
          const row = { id: uuidv7(), tenantId, estateId: estate.id, ...values, active: true, ...base };
          ops.push({
            row: r.row,
            key: r.key,
            action: "create",
            changes: [],
            apply: (d) => {
              d.insert(fields).values(row).run();
              setVarieties(d, row.id);
            },
          });
        } else {
          const currentVarieties = db
            .select()
            .from(fieldVarieties)
            .where(eq(fieldVarieties.fieldId, existing.id))
            .all()
            .map((x) => x.varietyId)
            .sort();
          const changes = diff(existing, values);
          if (JSON.stringify(currentVarieties) !== JSON.stringify([...varietyIds].sort())) changes.push("varieties");
          ops.push({
            row: r.row,
            key: r.key,
            action: changes.length ? "update" : "unchanged",
            changes,
            apply: (d) => {
              d.update(fields)
                .set({ ...values, version: existing.version + 1, updatedAt: now, updatedBy: by })
                .where(eq(fields.id, existing.id))
                .run();
              setVarieties(d, existing.id);
            },
          });
        }
        break;
      }
      case "workers": {
        const estate = estateFor(r.row, v.estateCode as string);
        if (!estate) continue;
        const existing = db
          .select()
          .from(workers)
          .all()
          .find((w) => w.employeeCode.toUpperCase() === r.key);
        if (existing && !ctx.can("masters.import", existing.estateId)) {
          errors.push({ row: r.row, column: "employee_code", message: "This worker belongs to an estate you cannot change" });
          continue;
        }
        const employmentType = v.employmentType as WorkerRow["employmentType"];
        // Only a file that has the employment_type column changes it; otherwise it stays as it is.
        const values = { estateId: estate.id, employeeCode: v.employeeCode as string, name: v.name as string, ...(employmentType !== undefined ? { employmentType } : {}) };
        if (!existing) {
          const row = { id: uuidv7(), tenantId, ...values, active: true, ...base };
          ops.push({ row: r.row, key: r.key, action: "create", changes: [], apply: (d) => d.insert(workers).values(row).run() });
        } else {
          const changes = diff(existing, values);
          ops.push({
            row: r.row,
            key: r.key,
            action: changes.length ? "update" : "unchanged",
            changes,
            apply: (d) =>
              d
                .update(workers)
                .set({ ...values, version: existing.version + 1, updatedAt: now, updatedBy: by })
                .where(eq(workers.id, existing.id))
                .run(),
          });
        }
        break;
      }
    }
  }
  return { ops, errors };
}

function summary(kind: ImportKind, hash: string, ops: Op[], errors: ImportPreview["errors"]): ImportPreview {
  const count = (a: PlannedRow["action"]) => ops.filter((o) => o.action === a).length;
  return {
    kind,
    previewHash: hash,
    totals: {
      rows: ops.length + new Set(errors.filter((e) => e.row > 1).map((e) => e.row)).size,
      create: count("create"),
      update: count("update"),
      unchanged: count("unchanged"),
      errors: errors.length,
    },
    rows: ops.map(({ row, key, action, changes }) => ({ row, key, action, changes })),
    errors: errors.sort((a, b) => a.row - b.row),
  };
}

export async function previewImport(ctx: TenantContext, kind: ImportKind, csv: string): Promise<ImportPreview> {
  if (!ctx.can("masters.import", null) && ctx.estates("masters.import") !== "ALL" && (ctx.estates("masters.import") as string[]).length === 0)
    throw new AppError(403, "FORBIDDEN", "You do not have permission to do this");
  const hash = await fileHash(kind, csv);
  const { ops, errors } = plan(ctx, kind, csv);
  return summary(kind, hash, ops, errors);
}

/**
 * Apply an import in one transaction. Re-committing the same file returns the first result
 * (idempotent). Any row error blocks the whole import: nothing is half-applied.
 */
export async function commitImport(ctx: TenantContext, kind: ImportKind, csv: string, previewHash: string) {
  const hash = await fileHash(kind, csv);
  if (hash !== previewHash) throw new AppError(409, "PREVIEW_MISMATCH", "The file changed after the preview. Preview it again.");
  const done = ctx.db
    .select()
    .from(importRuns)
    .where(and(eq(importRuns.kind, kind), eq(importRuns.fileHash, hash)))
    .get();
  if (done) return { ...(JSON.parse(done.resultJson) as ImportPreview), alreadyImported: true, importId: done.id };
  const { ops, errors } = plan(ctx, kind, csv);
  if (errors.length) throw new AppError(422, "IMPORT_HAS_ERRORS", `The file has ${errors.length} problem(s). Fix them and preview again.`);
  const result = summary(kind, hash, ops, errors);
  const importId = uuidv7();
  ctx.tx((db) => {
    for (const op of ops) if (op.action !== "unchanged") op.apply(db);
    db.insert(importRuns)
      .values({ id: importId, kind, fileHash: hash, resultJson: JSON.stringify(result), committedBy: ctx.scope.userId, committedAt: ctx.nowIso() })
      .run();
    ctx.audit(db, { action: "import.commit", entityType: "import", entityId: importId, estateId: null, after: { kind, fileHash: hash, totals: result.totals, rows: result.rows } });
  });
  return { ...result, alreadyImported: false, importId };
}
