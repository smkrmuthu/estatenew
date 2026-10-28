import { can } from "@cemms/domain";
import type { Context, Hono } from "hono";
import { ageHours, backupTenant, listBackups } from "../core/backup";
import { AppError, forbidden } from "../core/errors";
import { route } from "../core/registry";
import type { AppEnv } from "../core/types";

/** Backups older than this many hours are shown as late; the job runs about every 24 hours. */
const LATE_AFTER_HOURS = 30;

function owner(c: Context<AppEnv>) {
  const a = c.get("auth");
  if (!a) throw new AppError(401, "UNAUTHENTICATED", "Sign in again");
  // settings.manage is tenant-wide: the owner.
  if (!can(a.grants, "settings.manage", null)) throw forbidden();
  return a;
}

export function backupRoutes(app: Hono<AppEnv>) {
  route(app, { method: "get", path: "/admin/backups", summary: "Newest backups of my tenant's data", tag: "admin", auth: "bearer", permission: "settings.manage" }, async (c) => {
    const a = owner(c);
    const backups = await listBackups(c.env, `tenants/${a.tenant.id}/backups`, 10);
    const age = ageHours(backups);
    return c.json({ backups, ageHours: age, late: age === null || age > LATE_AFTER_HOURS, schedule: "Every night at about 2:00 am (India time)" });
  });

  route(app, { method: "post", path: "/admin/backups/run", summary: "Back up my tenant's data now", tag: "admin", auth: "bearer", permission: "settings.manage" }, async (c) => {
    const a = owner(c);
    const manifest = await backupTenant(c.env, { id: a.tenant.id, code: a.tenant.code, dbName: a.tenant.dbName }, "manual");
    return c.json(manifest, 201);
  });
}
