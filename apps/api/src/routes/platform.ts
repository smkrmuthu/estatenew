import { uuidv7 } from "@cemms/domain";
import { eq } from "drizzle-orm";
import type { Hono } from "hono";
import { z } from "zod";
import { audit } from "../auth/service";
import { controlDb } from "../control/db";
import { tenants, userGrants, users } from "../control/schema";
import { hashPassword, safeEqual } from "../core/crypto";
import { AppError } from "../core/errors";
import { readJson } from "../core/http";
import { route } from "../core/registry";
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
});

export function platformRoutes(app: Hono<AppEnv>) {
  route(app, { method: "post", path: "/platform/tenants", summary: "Create and provision a tenant (bootstrap credential)", tag: "platform", auth: "platform-token", body: createTenant }, async (c) => {
    const token = c.req.header("x-platform-token") ?? "";
    const expected = c.env.PLATFORM_BOOTSTRAP_TOKEN ?? "";
    if (expected.length < 32 || !safeEqual(token, expected)) throw new AppError(403, "FORBIDDEN", "You do not have permission to do this");
    const body = createTenant.parse(await readJson(c));
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
    return c.json({ ...provisioned.value, code: tenant.code, ownerUserId: owner.id }, 201);
  });
}
