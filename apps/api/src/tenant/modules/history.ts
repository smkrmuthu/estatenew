import { and, desc, eq } from "drizzle-orm";
import { AppError } from "../../core/errors";
import type { TenantContext } from "../context";
import { auditLog, recordRevisions } from "../schema";
import { getEstate } from "./organization";

export function listAudit(ctx: TenantContext, filter: { estateId?: string; entityType?: string; entityId?: string; limit: number }) {
  const allowed = ctx.estates("audit.read");
  if (allowed !== "ALL" && (!filter.estateId || !allowed.includes(filter.estateId))) throw new AppError(403, "FORBIDDEN", "You do not have permission to do this");
  if (filter.estateId) getEstate(ctx.db, filter.estateId);
  const conds = [];
  if (filter.estateId) conds.push(eq(auditLog.estateId, filter.estateId));
  if (filter.entityType) conds.push(eq(auditLog.entityType, filter.entityType));
  if (filter.entityId) conds.push(eq(auditLog.entityId, filter.entityId));
  return ctx.db
    .select()
    .from(auditLog)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(auditLog.at))
    .limit(Math.min(filter.limit, 500))
    .all();
}

export function recordHistory(ctx: TenantContext, entityType: string, entityId: string, estateId: string) {
  ctx.require("audit.read", estateId);
  getEstate(ctx.db, estateId);
  const rows = ctx.db
    .select()
    .from(recordRevisions)
    .where(and(eq(recordRevisions.entityType, entityType), eq(recordRevisions.entityId, entityId)))
    .orderBy(recordRevisions.version)
    .all()
    .map((r) => ({ ...r, data: JSON.parse(r.dataJson) as { estateId?: string } }));
  // The caller names the estate; the records must really belong to it.
  if (rows.some((r) => r.data.estateId !== estateId)) throw new AppError(403, "FORBIDDEN", "You do not have permission to do this");
  return rows;
}
