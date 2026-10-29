import { DurableObject } from "cloudflare:workers";
import {
  attendanceCorrection,
  conflictResolution,
  dailyLogCorrection,
  deleteMaster,
  estateInput,
  fieldInput,
  importCommit,
  importRequest,
  jobTypeInput,
  logKindInput,
  musterCorrection,
  sheetAction as sheetActionSchema,
  syncPush,
  varietyInput,
  workerInput,
} from "@cemms/contracts";
import { type GateStatus, isBusinessDate, SHIFTS, uuidv7 } from "@cemms/domain";
import { eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/durable-sqlite";
import { z } from "zod";
import { AppError, type RpcError, toRpcError } from "../core/errors";
import { log } from "../core/log";
import { type Db, type Scope, TenantContext } from "./context";
import { type MigrationState, runTenantMigrations } from "./migrate";
import * as attendance from "./modules/attendance";
import * as dailylog from "./modules/dailylog";
import * as history from "./modules/history";
import * as imports from "./modules/imports";
import * as muster from "./modules/muster";
import * as org from "./modules/organization";
import * as reports from "./modules/reports";
import * as settingsModule from "./modules/settings";
import { pushMutations } from "./modules/sync";
import * as schema from "./schema";

const day = z.object({ estateId: z.string(), businessDate: z.string().refine(isBusinessDate, "Use a date like 2026-11-01") });
/** An attendance register is per estate, day and shift (Day when not given). */
const attendanceDay = day.extend({ shift: z.enum(SHIFTS).optional() });
const withId = <T extends z.ZodTypeAny>(body: T) => z.object({ id: z.string(), body });
const withIdVersion = <T extends z.ZodTypeAny>(body: T) => z.object({ id: z.string().optional(), baseVersion: z.number().int().optional(), body });

/** Every operation the Worker may ask a tenant database to run, with its input schema. */
const OPS = {
  "org.reference": { input: z.object({ includeInactive: z.boolean().default(false) }), run: (c: TenantContext, i: { includeInactive: boolean }) => org.referenceData(c, i.includeInactive) },
  "org.createEstate": { input: estateInput, run: org.createEstate },
  "org.upsertField": {
    input: withIdVersion(fieldInput),
    run: (c: TenantContext, i: { id?: string; baseVersion?: number; body: z.infer<typeof fieldInput> }) => org.upsertField(c, i.body, i.id, i.baseVersion),
  },
  "org.upsertVariety": {
    input: withIdVersion(varietyInput),
    run: (c: TenantContext, i: { id?: string; baseVersion?: number; body: z.infer<typeof varietyInput> }) => org.upsertVariety(c, i.body, i.id, i.baseVersion),
  },
  "org.upsertJobType": {
    input: withIdVersion(jobTypeInput),
    run: (c: TenantContext, i: { id?: string; baseVersion?: number; body: z.infer<typeof jobTypeInput> }) => org.upsertJobType(c, i.body, i.id, i.baseVersion),
  },
  "org.upsertWorker": {
    input: withIdVersion(workerInput),
    run: (c: TenantContext, i: { id?: string; baseVersion?: number; body: z.infer<typeof workerInput> }) => org.upsertWorker(c, i.body, i.id, i.baseVersion),
  },
  "org.deleteWorker": { input: withId(deleteMaster), run: (c: TenantContext, i: { id: string; body: z.infer<typeof deleteMaster> }) => org.deleteWorker(c, i.id, i.body.reason) },
  "org.deleteField": { input: withId(deleteMaster), run: (c: TenantContext, i: { id: string; body: z.infer<typeof deleteMaster> }) => org.deleteField(c, i.id, i.body.reason) },
  "org.upsertLogKind": {
    input: withIdVersion(logKindInput),
    run: (c: TenantContext, i: { id?: string; baseVersion?: number; body: z.infer<typeof logKindInput> }) => org.upsertLogKind(c, i.body, i.id, i.baseVersion),
  },
  "import.preview": { input: importRequest, run: (c: TenantContext, i: z.infer<typeof importRequest>) => imports.previewImport(c, i.kind, i.csv) },
  "import.commit": { input: importCommit, run: (c: TenantContext, i: z.infer<typeof importCommit>) => imports.commitImport(c, i.kind, i.csv, i.previewHash) },
  "settings.list": { input: z.object({}), run: (c: TenantContext) => settingsModule.listSettings(c) },
  "settings.change": { input: z.object({ key: z.string(), value: z.unknown() }), run: (c: TenantContext, i: { key: string; value: unknown }) => settingsModule.changeSetting(c, i.key, i.value) },
  "gates.list": { input: z.object({}), run: (c: TenantContext) => settingsModule.listGates(c) },
  "gates.record": {
    input: withId(
      z.object({
        status: z.enum(["confirmed", "open", "answered-unclear"]),
        answer: z.string().min(1).max(1000),
        approver: z.string().min(1).max(120),
        decidedOn: z.string().refine(isBusinessDate),
        source: z.string().min(1).max(300),
      }),
    ),
    run: (c: TenantContext, i: { id: string; body: { status: GateStatus; answer: string; approver: string; decidedOn: string; source: string } }) => settingsModule.recordGate(c, i.id, i.body),
  },
  "admin.readiness": { input: z.object({}), run: (c: TenantContext) => settingsModule.readiness(c) },
  "attendance.sheet": { input: attendanceDay, run: (c: TenantContext, i: z.infer<typeof attendanceDay>) => attendance.getSheet(c, i.estateId, i.businessDate, i.shift) },
  "attendance.sheetAction": {
    input: day.extend({ body: sheetActionSchema }),
    run: (c: TenantContext, i: z.infer<typeof day> & { body: z.infer<typeof sheetActionSchema> }) => attendance.sheetAction(c, i.estateId, i.businessDate, i.body.action, i.body.reason, i.body.shift),
  },
  "attendance.correct": { input: withId(attendanceCorrection), run: (c: TenantContext, i: { id: string; body: z.infer<typeof attendanceCorrection> }) => attendance.correctRecord(c, i.id, i.body) },
  "conflicts.list": { input: z.object({ estateId: z.string() }), run: (c: TenantContext, i: { estateId: string }) => attendance.listConflicts(c, i.estateId) },
  "conflicts.resolve": {
    input: withId(conflictResolution),
    run: (c: TenantContext, i: { id: string; body: z.infer<typeof conflictResolution> }) => attendance.resolveAttendanceConflict(c, i.id, i.body.keep, i.body.reason),
  },
  "muster.list": { input: day, run: (c: TenantContext, i: z.infer<typeof day>) => muster.listMuster(c, i.estateId, i.businessDate) },
  "muster.days": { input: day, run: (c: TenantContext, i: z.infer<typeof day>) => reports.musterDays(c, i.estateId, i.businessDate) },
  "muster.correct": { input: withId(musterCorrection), run: (c: TenantContext, i: { id: string; body: z.infer<typeof musterCorrection> }) => muster.correctMuster(c, i.id, i.body) },
  "dailylog.list": { input: day, run: (c: TenantContext, i: z.infer<typeof day>) => dailylog.listDailyLog(c, i.estateId, i.businessDate) },
  "dailylog.correct": { input: withId(dailyLogCorrection), run: (c: TenantContext, i: { id: string; body: z.infer<typeof dailyLogCorrection> }) => dailylog.correctDailyLog(c, i.id, i.body) },
  "sync.push": { input: syncPush, run: pushMutations },
  "reports.daily": { input: day, run: (c: TenantContext, i: z.infer<typeof day>) => reports.dailySummary(c, i.estateId, i.businessDate) },
  "reports.dashboard": { input: day, run: (c: TenantContext, i: z.infer<typeof day>) => reports.dashboard(c, i.estateId, i.businessDate) },
  "reports.plucking": {
    input: z.object({ estateId: z.string(), from: z.string().refine(isBusinessDate), to: z.string().refine(isBusinessDate) }),
    run: (c: TenantContext, i: { estateId: string; from: string; to: string }) => reports.pluckingReport(c, i.estateId, i.from, i.to),
  },
  "reports.export": {
    input: z.object({ estateId: z.string(), from: z.string().refine(isBusinessDate), to: z.string().refine(isBusinessDate), format: z.enum(["old", "new"]) }),
    run: (c: TenantContext, i: { estateId: string; from: string; to: string; format: "old" | "new" }) => reports.exportData(c, i.estateId, i.from, i.to, i.format),
  },
  "reports.exportAll": {
    input: z.object({ from: z.string().refine(isBusinessDate), to: z.string().refine(isBusinessDate), format: z.enum(["old", "new"]) }),
    run: (c: TenantContext, i: { from: string; to: string; format: "old" | "new" }) => reports.exportAllEstates(c, i.from, i.to, i.format),
  },
  "dailylog.range": {
    input: z.object({ estateId: z.string(), from: z.string().refine(isBusinessDate), to: z.string().refine(isBusinessDate) }),
    run: (c: TenantContext, i: { estateId: string; from: string; to: string }) => reports.dailyLogRange(c, i.estateId, i.from, i.to),
  },
  "attendance.workerHistory": {
    input: z.object({ estateId: z.string(), workerId: z.string(), days: z.number().int().min(1).max(120).default(30) }),
    run: (c: TenantContext, i: { estateId: string; workerId: string; days: number }) => reports.workerHistory(c, i.estateId, i.workerId, i.days),
  },
  "audit.list": {
    input: z.object({ estateId: z.string().optional(), entityType: z.string().optional(), entityId: z.string().optional(), limit: z.number().int().min(1).max(500).default(100) }),
    run: (c: TenantContext, i: { estateId?: string; entityType?: string; entityId?: string; limit: number }) => history.listAudit(c, i),
  },
  "audit.history": {
    input: z.object({ entityType: z.string(), entityId: z.string(), estateId: z.string() }),
    run: (c: TenantContext, i: { entityType: string; entityId: string; estateId: string }) => history.recordHistory(c, i.entityType, i.entityId, i.estateId),
  },
  "org.validateEstates": {
    input: z.object({ estateIds: z.array(z.string()).max(100) }),
    run: (c: TenantContext, i: { estateIds: string[] }) => ({ missing: i.estateIds.filter((id) => !c.db.select().from(schema.estates).where(eq(schema.estates.id, id)).get()) }),
  },
} as const;

export type TenantOp = keyof typeof OPS;
export type TenantOpResult<K extends TenantOp> = Awaited<ReturnType<(typeof OPS)[K]["run"]>>;
export type RunResult<T> = { ok: true; value: T } | { ok: false; error: RpcError };

export interface ProvisionInput {
  tenantId: string;
  actor: string;
  seedGatesFromRegister: boolean;
}

/** One SQLite database per tenant (ADR-0001). Only the Worker talks to it, with a verified scope. */
export class TenantDb extends DurableObject<Env> {
  private readonly db: Db;
  private migration: MigrationState = { version: 0, applied: [], error: "not started" };

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.db = drizzle(ctx.storage, { schema });
    ctx.blockConcurrencyWhile(async () => {
      try {
        this.migration = runTenantMigrations(ctx.storage);
      } catch (e) {
        this.migration = { version: 0, applied: [], error: (e as Error).message };
      }
      if (this.migration.error) log("error", "tenant.migration.failed", { error: this.migration.error });
    });
  }

  private tenantId(): string | null {
    return this.db.select().from(schema.tenantMeta).where(eq(schema.tenantMeta.key, "tenant_id")).get()?.value ?? null;
  }

  /** Bind this database to a tenant. Idempotent for the same tenant; refuses another tenant. */
  async provision(input: ProvisionInput): Promise<RunResult<{ tenantId: string; migrationVersion: number; gatesSeeded: number }>> {
    if (this.migration.error) return { ok: false, error: { __appError: true, status: 503, code: "MIGRATION_FAILED", message: "Tenant database is not ready" } };
    const existing = this.tenantId();
    if (existing && existing !== input.tenantId) return { ok: false, error: { __appError: true, status: 409, code: "TENANT_MISMATCH", message: "This database belongs to another tenant" } };
    const now = new Date().toISOString();
    let gatesSeeded = 0;
    this.db.transaction((tx) => {
      const db = tx as unknown as Db;
      if (!existing) {
        db.insert(schema.tenantMeta).values({ key: "tenant_id", value: input.tenantId }).run();
        db.insert(schema.tenantMeta).values({ key: "provisioned_at", value: now }).run();
      }
      if (input.seedGatesFromRegister) gatesSeeded = settingsModule.seedGatesFromRegister(db, input.actor, now);
    });
    return { ok: true, value: { tenantId: input.tenantId, migrationVersion: this.migration.version, gatesSeeded } };
  }

  /** Session length policy for sign-in (auth.offlineSessionHours, OC-101). Not sensitive. */
  async sessionHours(tenantId: string): Promise<number> {
    if (this.migration.error || this.tenantId() !== tenantId) return 12;
    return settingsModule.setting(this.db, "auth.offlineSessionHours");
  }

  /** Full logical copy of the tenant database for the nightly backup. */
  async snapshot(tenantId: string): Promise<string> {
    if (this.migration.error || this.tenantId() !== tenantId) throw new Error("snapshot refused");
    const tables = this.ctx.storage.sql.exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'").toArray();
    const out: Record<string, unknown[]> = {};
    for (const t of tables) out[t.name] = this.ctx.storage.sql.exec(`SELECT * FROM "${t.name.replaceAll('"', "")}"`).toArray();
    return JSON.stringify({ tenantId, at: new Date().toISOString(), migration: this.migration.version, tables: out });
  }

  /**
   * Load a backup into this database, for recovery. Only an empty database accepts it (never a live one), the backup
   * must come from the same tenant and the same migration version, and the row counts are checked before the work is kept.
   */
  async restore(tenantId: string, snapshot: string): Promise<RunResult<{ tables: Record<string, number> }>> {
    const fail = (status: RpcError["status"], code: string, message: string): RunResult<never> => ({ ok: false, error: { __appError: true, status, code, message } });
    if (this.migration.error) return fail(503, "MIGRATION_FAILED", "Tenant database is not ready");
    const bound = this.tenantId();
    if (bound && bound !== tenantId) return fail(409, "TENANT_MISMATCH", "This database belongs to another tenant");
    let data: { tenantId: string; migration: number; tables: Record<string, Record<string, unknown>[]> };
    try {
      data = JSON.parse(snapshot);
    } catch {
      return fail(422, "BACKUP_UNREADABLE", "The backup is not readable");
    }
    if (data.tenantId !== tenantId) return fail(409, "TENANT_MISMATCH", "This backup belongs to another tenant");
    if (data.migration !== this.migration.version)
      return fail(409, "VERSION_MISMATCH", `The backup is from database version ${data.migration} but this one is ${this.migration.version}. Restore with the matching app version.`);
    const sql = this.ctx.storage.sql;
    for (const t of ["estates", "workers", "attendance_records", "muster_entries", "dailylog_entries"]) {
      if (sql.exec<{ n: number }>(`SELECT count(*) AS n FROM "${t}"`).one().n > 0) return fail(409, "NOT_EMPTY", "This database already holds data. Restore into a new, empty database.");
    }
    const NAME = /^[A-Za-z0-9_]+$/;
    const existing = new Set(
      sql
        .exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")
        .toArray()
        .map((r) => r.name),
    );
    const counts: Record<string, number> = {};
    try {
      this.ctx.storage.transactionSync(() => {
        sql.exec("PRAGMA defer_foreign_keys = ON");
        for (const [name, rows] of Object.entries(data.tables)) {
          if (name === "_migrations" || name.startsWith("sqlite_") || name.startsWith("_cf_")) continue;
          if (!NAME.test(name) || !existing.has(name)) throw new Error(`Unknown table ${name}`);
          sql.exec(`DELETE FROM "${name}"`);
          for (const row of rows) {
            const cols = Object.keys(row);
            if (!cols.every((c) => NAME.test(c))) throw new Error(`Unexpected column in ${name}`);
            sql.exec(`INSERT INTO "${name}" (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`, ...cols.map((c) => row[c] as string | number | null));
          }
          const n = sql.exec<{ n: number }>(`SELECT count(*) AS n FROM "${name}"`).one().n;
          if (n !== rows.length) throw new Error(`Row count differs in ${name}`);
          counts[name] = n;
        }
      });
    } catch (e) {
      log("error", "restore.failed", { tenantId, error: (e as Error).message });
      return fail(500, "RESTORE_FAILED", "The restore did not complete and nothing was kept");
    }
    return { ok: true, value: { tables: counts } };
  }

  async health(): Promise<{ migration: MigrationState; provisioned: boolean; sizeBytes: number; outboxBacklog: number }> {
    const backlog = this.migration.error ? 0 : this.db.select().from(schema.outboxEvents).where(isNull(schema.outboxEvents.publishedAt)).all().length;
    return { migration: this.migration, provisioned: !this.migration.error && this.tenantId() !== null, sizeBytes: this.ctx.storage.sql.databaseSize, outboxBacklog: backlog };
  }

  async run<K extends TenantOp>(scope: Scope, op: K, input: unknown): Promise<RunResult<TenantOpResult<K>>> {
    try {
      if (this.migration.error) throw new AppError(503, "MIGRATION_FAILED", "Tenant database is not ready");
      const bound = this.tenantId();
      // Defence in depth: the Worker already resolved this object from the verified token.
      if (!bound) throw new AppError(503, "TENANT_NOT_PROVISIONED", "Tenant database is not ready");
      if (bound !== scope.tenantId) throw new AppError(403, "TENANT_MISMATCH", "You do not have permission to do this");
      const def = OPS[op];
      if (!def) throw new AppError(404, "UNKNOWN_OPERATION", "Unknown operation");
      const parsed = def.input.parse(input);
      const ctx = new TenantContext(this.db, scope);
      const value = await (def.run as (c: TenantContext, i: unknown) => unknown)(ctx, parsed);
      await this.scheduleOutbox();
      return { ok: true, value: value as TenantOpResult<K> };
    } catch (e) {
      const rpc = toRpcError(e);
      if (rpc) return { ok: false, error: rpc };
      log("error", "tenant.op.failed", { requestId: scope.requestId, tenantId: scope.tenantId, op, error: (e as Error).message, stack: (e as Error).stack?.split("\n").slice(0, 3).join(" | ") });
      return { ok: false, error: { __appError: true, status: 500, code: "INTERNAL", message: "Something went wrong" } };
    }
  }

  private async scheduleOutbox(): Promise<void> {
    const pending = this.db.select({ id: schema.outboxEvents.id }).from(schema.outboxEvents).where(isNull(schema.outboxEvents.publishedAt)).limit(1).get();
    if (pending && (await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + 1000);
  }

  /** Deliver outbox events to the jobs queue; consumers are idempotent on the event id. */
  override async alarm(): Promise<void> {
    const batch = this.db.select().from(schema.outboxEvents).where(isNull(schema.outboxEvents.publishedAt)).orderBy(schema.outboxEvents.createdAt).limit(100).all();
    if (batch.length === 0) return;
    try {
      await this.env.JOBS.sendBatch(batch.map((e) => ({ body: { eventId: e.id, type: e.type, entityType: e.entityType, entityId: e.entityId, payload: JSON.parse(e.payloadJson) } })));
      const now = new Date().toISOString();
      this.db.transaction((tx) => {
        for (const e of batch)
          (tx as unknown as Db)
            .update(schema.outboxEvents)
            .set({ publishedAt: now, attempts: e.attempts + 1 })
            .where(eq(schema.outboxEvents.id, e.id))
            .run();
      });
    } catch (err) {
      this.db.transaction((tx) => {
        for (const e of batch)
          (tx as unknown as Db)
            .update(schema.outboxEvents)
            .set({ attempts: e.attempts + 1 })
            .where(eq(schema.outboxEvents.id, e.id))
            .run();
      });
      log("warn", "outbox.publish.failed", { error: (err as Error).message, count: batch.length });
      await this.ctx.storage.setAlarm(Date.now() + Math.min(300_000, 5000 * 2 ** Math.min(6, batch[0]?.attempts ?? 0)));
      return;
    }
    await this.scheduleOutbox();
  }
}

export const newTenantDbName = () => `tenant-${uuidv7()}`;
