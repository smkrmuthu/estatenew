import { can, canAnyEstate, type Environment, estatesWith, type Grant, type Permission, uuidv7 } from "@cemms/domain";
import type { DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";
import { AppError, forbidden } from "../core/errors";
import * as schema from "./schema";

export type Db = DrizzleSqliteDODatabase<typeof schema>;

/** Who is calling, built by the Worker from a verified token. Never taken from the client. */
export interface Scope {
  tenantId: string;
  userId: string;
  sessionId: string;
  deviceId: string;
  grants: Grant[];
  requestId: string;
  environment: Environment;
}

export class TenantContext {
  constructor(
    readonly db: Db,
    readonly scope: Scope,
    readonly clock: () => Date = () => new Date(),
  ) {}

  nowIso(): string {
    return this.clock().toISOString();
  }

  can(permission: Permission, estateId: string | null): boolean {
    return can(this.scope.grants, permission, estateId);
  }

  /** The permission on any estate: for lists every estate shares. */
  canAny(permission: Permission): boolean {
    return canAnyEstate(this.scope.grants, permission);
  }

  requireAny(permission: Permission): void {
    if (!this.canAny(permission)) throw forbidden();
  }

  require(permission: Permission, estateId: string | null): void {
    if (!this.can(permission, estateId)) throw forbidden();
  }

  /** Estate ids this user may read with the permission, or "ALL". */
  estates(permission: Permission): "ALL" | string[] {
    return estatesWith(this.scope.grants, permission);
  }

  /** Run fn in a SQLite transaction; any throw rolls everything back. */
  tx<T>(fn: (db: Db) => T): T {
    return this.db.transaction((tx) => fn(tx as unknown as Db));
  }

  audit(
    db: Db,
    entry: {
      action: string;
      entityType: string;
      entityId: string | null;
      estateId: string | null;
      reason?: string | null;
      before?: unknown;
      after?: unknown;
      mutationId?: string | null;
    },
  ): void {
    db.insert(schema.auditLog)
      .values({
        id: uuidv7(),
        tenantId: this.scope.tenantId,
        estateId: entry.estateId,
        actorUserId: this.scope.userId,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        requestId: this.scope.requestId,
        deviceId: this.scope.deviceId,
        mutationId: entry.mutationId ?? null,
        reason: entry.reason ?? null,
        beforeJson: entry.before === undefined ? null : JSON.stringify(entry.before),
        afterJson: entry.after === undefined ? null : JSON.stringify(entry.after),
        at: this.nowIso(),
      })
      .run();
  }

  /** Append the new version of an operational record to its history. */
  revision(db: Db, entityType: string, entityId: string, version: number, data: unknown, change: string, reason: string | null, mutationId: string | null): void {
    db.insert(schema.recordRevisions)
      .values({ id: uuidv7(), entityType, entityId, version, dataJson: JSON.stringify(data), change, reason, actorUserId: this.scope.userId, mutationId, at: this.nowIso() })
      .run();
  }

  /** Transactional outbox: written in the same transaction as the change it describes. */
  emit(db: Db, type: string, entityType: string, entityId: string, payload: Record<string, unknown>): void {
    db.insert(schema.outboxEvents)
      .values({ id: uuidv7(), type, entityType, entityId, payloadJson: JSON.stringify({ tenantId: this.scope.tenantId, ...payload }), createdAt: this.nowIso() })
      .run();
  }
}

export function assertFound<T>(value: T | undefined | null, what: string): T {
  if (value === undefined || value === null) throw new AppError(404, "NOT_FOUND", `${what} not found`);
  return value;
}

export function staleVersion(): AppError {
  return new AppError(409, "STALE_VERSION", "Someone else changed this record. Reload and try again.");
}
