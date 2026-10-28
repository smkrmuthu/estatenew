import { uuidv7 } from "@cemms/domain";
import { eq } from "drizzle-orm";
import type { Context, Hono } from "hono";
import { z } from "zod";
import { audit } from "../auth/service";
import { controlDb } from "../control/db";
import { tenantDomains, tenants, userGrants, users } from "../control/schema";
import { listBackups, readBackup, runAllBackups } from "../core/backup";
import { hashPassword, safeEqual } from "../core/crypto";
import { AppError } from "../core/errors";
import { readJson } from "../core/http";
import { route } from "../core/registry";
import { DOMAIN_PATTERN } from "../core/site";
import { tenantStub } from "../core/tenant-stub";
import type { AppEnv } from "../core/types";
import { newTenantDbName } from "../tenant/tenant-db";

const createTenant = z.object({
  code: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]{2,40}$/),
  name: z.string().trim().min(1).max(120),
  owner: z.object({
    username: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9._-]{2,60}$/),
    displayName: z.string().trim().min(1).max(120),
    password: z.string().min(12).max(200),
  }),
  /** Only for the first tenant, whose owner confirmation is recorded in docs/owner-confirmations.json. */
  seedGatesFromRegister: z.boolean().default(false),
  /** Site addresses for this tenant, for example glazebrooke.oneuptech.co. */
  domains: z.array(z.string().trim().toLowerCase().regex(DOMAIN_PATTERN, "Use a host name like glazebrooke.oneuptech.co")).max(5).default([]),
});

function requirePlatform(c: Context<AppEnv>) {
  const token = c.req.header("x-platform-token") ?? "";
  const expected = c.env.PLATFORM_BOOTSTRAP_TOKEN ?? "";
  if (expected.length < 32 || !safeEqual(token, expected)) throw new AppError(403, "FORBIDDEN", "You do not have permission to do this");
}

export function platformRoutes(app: Hono<AppEnv>) {
  route(app, { method: "post", path: "/platform/tenants", summary: "Create and provision a tenant (bootstrap credential)", tag: "platform", auth: "platform-token", body: createTenant }, async (c) => {
    requirePlatform(c);
    const body = createTenant.parse(await readJson(c));
    for (const domain of body.domains)
      if (await db0(c).select().from(tenantDomains).where(eq(tenantDomains.domain, domain)).get()) throw new AppError(409, "DOMAIN_TAKEN", `${domain} already belongs to a tenant`);
    const db = controlDb(c.env);
    if (await db.select().from(tenants).where(eq(tenants.code, body.code)).get()) throw new AppError(409, "CODE_TAKEN", "This tenant code is already used");
    const now = new Date().toISOString();
    const tenant = { id: uuidv7(), code: body.code, name: body.name, status: "ACTIVE" as const, dbName: newTenantDbName(), locationHint: c.env.LOCATION_HINT, createdAt: now };
    const owner = {
      id: uuidv7(),
      tenantId: tenant.id,
      username: body.owner.username,
      displayName: body.owner.displayName,
      passwordHash: await hashPassword(body.owner.password),
      status: "ACTIVE" as const,
      mustChangePassword: true,
      passwordChangedAt: now,
      createdAt: now,
    };
    await db.batch([
      db.insert(tenants).values(tenant),
      db.insert(users).values(owner),
      db.insert(userGrants).values({ id: uuidv7(), tenantId: tenant.id, userId: owner.id, estateKey: "", role: "OWNER", createdAt: now, createdBy: "platform" }),
      ...body.domains.map((domain) => db.insert(tenantDomains).values({ domain, tenantId: tenant.id, createdAt: now })),
    ]);
    const provisioned = await tenantStub(c.env, tenant.dbName).provision({ tenantId: tenant.id, actor: "platform", seedGatesFromRegister: body.seedGatesFromRegister });
    if (!provisioned.ok) throw new AppError(503, provisioned.error.code, provisioned.error.message);
    await db.update(tenants).set({ provisionedAt: new Date().toISOString() }).where(eq(tenants.id, tenant.id));
    await audit(db, {
      actor: "platform",
      action: "tenant.create",
      tenantId: tenant.id,
      requestId: c.get("requestId"),
      detail: { code: tenant.code, migrationVersion: provisioned.value.migrationVersion, gatesSeeded: provisioned.value.gatesSeeded },
    });
    return c.json({ ...provisioned.value, code: tenant.code, ownerUserId: owner.id, domains: body.domains }, 201);
  });

  const addDomain = z.object({ domain: z.string().trim().toLowerCase().regex(DOMAIN_PATTERN, "Use a host name like glazebrooke.oneuptech.co") });
  route(
    app,
    { method: "post", path: "/platform/tenants/:code/domains", summary: "Give a tenant another site address (bootstrap credential)", tag: "platform", auth: "platform-token", body: addDomain },
    async (c) => {
      requirePlatform(c);
      const { domain } = addDomain.parse(await readJson(c));
      const db = db0(c);
      const tenant = await db
        .select()
        .from(tenants)
        .where(eq(tenants.code, c.req.param("code") ?? ""))
        .get();
      if (!tenant) throw new AppError(404, "NOT_FOUND", "Tenant not found");
      const existing = await db.select().from(tenantDomains).where(eq(tenantDomains.domain, domain)).get();
      if (existing && existing.tenantId !== tenant.id) throw new AppError(409, "DOMAIN_TAKEN", `${domain} already belongs to another tenant`);
      if (!existing) await db.insert(tenantDomains).values({ domain, tenantId: tenant.id, createdAt: new Date().toISOString() });
      await audit(db, { actor: "platform", action: "tenant.domain.add", tenantId: tenant.id, requestId: c.get("requestId"), detail: { domain } });
      return c.json({ code: tenant.code, domain }, 201);
    },
  );

  route(
    app,
    { method: "post", path: "/platform/backups/run", summary: "Back up the control database and every tenant now (bootstrap credential)", tag: "platform", auth: "platform-token" },
    async (c) => {
      requirePlatform(c);
      const run = await runAllBackups(c.env, "manual");
      await audit(controlDb(c.env), {
        actor: "platform",
        action: "backup.run",
        requestId: c.get("requestId"),
        detail: { ok: run.ok, results: run.results.map((r) => ({ kind: r.kind, code: r.code, ok: r.ok })) },
      });
      return c.json(run, run.ok ? 200 : 500);
    },
  );

  route(
    app,
    { method: "get", path: "/platform/backups", summary: "Newest backups of the control database and each tenant (bootstrap credential)", tag: "platform", auth: "platform-token" },
    async (c) => {
      requirePlatform(c);
      const all = await controlDb(c.env).select().from(tenants).all();
      return c.json({
        control: await listBackups(c.env, "control/backups", 5),
        tenants: await Promise.all(all.map(async (t) => ({ code: t.code, backups: await listBackups(c.env, `tenants/${t.id}/backups`, 5) }))),
      });
    },
  );

  const restoreBody = z.object({
    /** A new database name; a restore never goes into the live database. */
    targetDbName: z
      .string()
      .trim()
      .regex(/^[a-z0-9-]{8,80}$/)
      .optional(),
    /** The backup to use (its R2 key ending in .json.enc); the newest verified one when left out. */
    backupKey: z.string().trim().max(300).optional(),
  });
  route(
    app,
    {
      method: "post",
      path: "/platform/tenants/:code/restore",
      summary: "Restore a tenant's backup into a new, empty database. Switching the tenant over is a separate step (bootstrap credential)",
      tag: "platform",
      auth: "platform-token",
      body: restoreBody,
    },
    async (c) => {
      requirePlatform(c);
      const body = restoreBody.parse(await readJson(c));
      const code = c.req.param("code") ?? "";
      const db = controlDb(c.env);
      const tenant = await db.select().from(tenants).where(eq(tenants.code, code)).get();
      if (!tenant) throw new AppError(404, "NOT_FOUND", "Tenant not found");
      const target = body.targetDbName ?? `${tenant.dbName}-restore-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}`;
      if (target === tenant.dbName) throw new AppError(422, "TARGET_IS_LIVE", "Restore into a new database, never the live one");
      const manifests = await listBackups(c.env, `tenants/${tenant.id}/backups`, 50);
      const manifest = body.backupKey ? manifests.find((m) => m.key === body.backupKey) : manifests.find((m) => m.verified);
      if (!manifest) throw new AppError(404, "NO_BACKUP", "No matching verified backup");
      const plain = await readBackup(c.env, manifest).catch((e) => {
        throw new AppError(422, "BACKUP_UNREADABLE", (e as Error).message);
      });
      const restored = await tenantStub(c.env, target).restore(tenant.id, plain);
      if (!restored.ok) throw new AppError(restored.error.status, restored.error.code, restored.error.message);
      await audit(db, { actor: "platform", action: "tenant.restore", tenantId: tenant.id, requestId: c.get("requestId"), detail: { target, backup: manifest.key, at: manifest.at } });
      return c.json({ code, target, backup: manifest.key, backupAt: manifest.at, tables: restored.value.tables, switchOver: `UPDATE tenants SET db_name = '${target}' WHERE code = '${code}';` });
    },
  );
}

const db0 = (c: Context<AppEnv>) => controlDb(c.env);
