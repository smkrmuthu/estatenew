import { passwordReset, userCreate, userUpdate } from "@cemms/contracts";
import { can, uuidv7 } from "@cemms/domain";
import { and, eq, isNull } from "drizzle-orm";
import type { Context, Hono } from "hono";
import { z } from "zod";
import { audit, grantsOf } from "../auth/service";
import { controlDb } from "../control/db";
import { sessions, userGrants, users } from "../control/schema";
import { hashPassword } from "../core/crypto";
import { AppError, forbidden } from "../core/errors";
import { readJson } from "../core/http";
import { route } from "../core/registry";
import { callTenant } from "../core/tenant-stub";
import type { AppEnv } from "../core/types";

function auth(c: Context<AppEnv>) {
  const a = c.get("auth");
  if (!a) throw new AppError(401, "UNAUTHENTICATED", "Sign in again");
  if (!can(a.grants, "users.manage", null)) throw forbidden();
  return a;
}

export function userRoutes(app: Hono<AppEnv>) {
  route(app, { method: "get", path: "/admin/users", summary: "List users of my tenant", tag: "admin", auth: "bearer", permission: "users.manage" }, async (c) => {
    const a = auth(c);
    const db = controlDb(c.env);
    const rows = await db.select().from(users).where(eq(users.tenantId, a.tenant.id)).all();
    const grants = await db.select().from(userGrants).where(eq(userGrants.tenantId, a.tenant.id)).all();
    // The newest session is the last sign-in.
    const lastSignIn = new Map<string, string>();
    for (const s of await db.select({ userId: sessions.userId, createdAt: sessions.createdAt }).from(sessions).where(eq(sessions.tenantId, a.tenant.id)).all()) {
      if ((lastSignIn.get(s.userId) ?? "") < s.createdAt) lastSignIn.set(s.userId, s.createdAt);
    }
    return c.json(
      rows.map((u) => ({
        id: u.id,
        username: u.username,
        displayName: u.displayName,
        status: u.status,
        mfaEnabled: u.mfaEnabled,
        lockedUntil: u.lockedUntil,
        lastSignInAt: lastSignIn.get(u.id) ?? null,
        grants: grantsOf(grants.filter((g) => g.userId === u.id)),
      })),
    );
  });

  route(app, { method: "post", path: "/admin/users", summary: "Create a user with estate-scoped roles", tag: "admin", auth: "bearer", permission: "users.manage", body: userCreate }, async (c) => {
    const a = auth(c);
    const body = userCreate.parse(await readJson(c));
    if (body.grants.some((g) => g.role === "PLATFORM_ADMIN")) throw new AppError(422, "ROLE_NOT_ALLOWED", "This role cannot be given here");
    const estateIds = [...new Set(body.grants.map((g) => g.estateId).filter((x): x is string => x !== null))];
    if (estateIds.length) {
      const { missing } = await callTenant(c, "org.validateEstates", { estateIds });
      if (missing.length) throw new AppError(422, "ESTATE_UNKNOWN", "An estate was not found", { grants: "Unknown estate" });
    }
    const db = controlDb(c.env);
    if (
      await db
        .select()
        .from(users)
        .where(and(eq(users.tenantId, a.tenant.id), eq(users.username, body.username)))
        .get()
    )
      throw new AppError(409, "USERNAME_TAKEN", "This user name is already used", { username: "Already used" });
    const now = new Date().toISOString();
    const user = {
      id: uuidv7(),
      tenantId: a.tenant.id,
      username: body.username,
      displayName: body.displayName,
      passwordHash: await hashPassword(body.password),
      status: "ACTIVE" as const,
      mustChangePassword: true,
      passwordChangedAt: now,
      createdAt: now,
    };
    await db.batch([
      db.insert(users).values(user),
      ...body.grants.map((g) =>
        db.insert(userGrants).values({ id: uuidv7(), tenantId: a.tenant.id, userId: user.id, estateKey: g.estateId ?? "", role: g.role, createdAt: now, createdBy: a.user.id }),
      ),
    ]);
    await audit(db, { actor: a.user.id, action: "user.create", tenantId: a.tenant.id, userId: user.id, requestId: c.get("requestId"), detail: { grants: body.grants } });
    return c.json({ id: user.id, username: user.username, displayName: user.displayName, grants: body.grants }, 201);
  });

  route(
    app,
    { method: "put", path: "/admin/users/:id", summary: "Change a user's name, roles and estates; their sessions end", tag: "admin", auth: "bearer", permission: "users.manage", body: userUpdate },
    async (c) => {
      const a = auth(c);
      const body = userUpdate.parse(await readJson(c));
      const id = c.req.param("id") ?? "";
      if (id === a.user.id) throw new AppError(422, "SELF_EDIT", "You cannot change your own access");
      if (body.grants.some((g) => g.role === "PLATFORM_ADMIN")) throw new AppError(422, "ROLE_NOT_ALLOWED", "This role cannot be given here");
      const estateIds = [...new Set(body.grants.map((g) => g.estateId).filter((x): x is string => x !== null))];
      if (estateIds.length) {
        const { missing } = await callTenant(c, "org.validateEstates", { estateIds });
        if (missing.length) throw new AppError(422, "ESTATE_UNKNOWN", "An estate was not found", { grants: "Unknown estate" });
      }
      const db = controlDb(c.env);
      const target = await db
        .select()
        .from(users)
        .where(and(eq(users.id, id), eq(users.tenantId, a.tenant.id)))
        .get();
      if (!target) throw new AppError(404, "NOT_FOUND", "User not found");
      const before = grantsOf(
        await db
          .select()
          .from(userGrants)
          .where(and(eq(userGrants.userId, id), eq(userGrants.tenantId, a.tenant.id)))
          .all(),
      );
      // Never leave the tenant without an active owner.
      if (before.some((g) => g.role === "OWNER") && !body.grants.some((g) => g.role === "OWNER")) {
        const otherOwners = (
          await db
            .select()
            .from(userGrants)
            .where(and(eq(userGrants.tenantId, a.tenant.id), eq(userGrants.role, "OWNER")))
            .all()
        ).filter((g) => g.userId !== id);
        if (otherOwners.length === 0) throw new AppError(422, "LAST_OWNER", "The estate needs at least one owner");
      }
      const now = new Date().toISOString();
      await db.batch([
        db.update(users).set({ displayName: body.displayName }).where(eq(users.id, id)),
        db.delete(userGrants).where(and(eq(userGrants.userId, id), eq(userGrants.tenantId, a.tenant.id))),
        ...body.grants.map((g) => db.insert(userGrants).values({ id: uuidv7(), tenantId: a.tenant.id, userId: id, estateKey: g.estateId ?? "", role: g.role, createdAt: now, createdBy: a.user.id })),
        db
          .update(sessions)
          .set({ revokedAt: now, revokedReason: "access-changed" })
          .where(and(eq(sessions.userId, id), isNull(sessions.revokedAt))),
      ]);
      await audit(db, {
        actor: a.user.id,
        action: "user.update",
        tenantId: a.tenant.id,
        userId: id,
        requestId: c.get("requestId"),
        detail: { before, after: body.grants, displayName: body.displayName },
      });
      return c.json({ id, displayName: body.displayName, grants: body.grants });
    },
  );

  route(
    app,
    { method: "post", path: "/admin/users/:id/enable", summary: "Re-enable a disabled user; they sign in again with their password", tag: "admin", auth: "bearer", permission: "users.manage" },
    async (c) => {
      const a = auth(c);
      const id = c.req.param("id") ?? "";
      const db = controlDb(c.env);
      const target = await db
        .select()
        .from(users)
        .where(and(eq(users.id, id), eq(users.tenantId, a.tenant.id)))
        .get();
      if (!target) throw new AppError(404, "NOT_FOUND", "User not found");
      await db.update(users).set({ status: "ACTIVE", failedAttempts: 0, lockedUntil: null }).where(eq(users.id, id));
      await audit(db, { actor: a.user.id, action: "user.enable", tenantId: a.tenant.id, userId: id, requestId: c.get("requestId") });
      return c.json({ ok: true });
    },
  );

  route(
    app,
    {
      method: "post",
      path: "/admin/users/:id/disable",
      summary: "Disable a user and end their sessions",
      tag: "admin",
      auth: "bearer",
      permission: "users.manage",
      body: z.object({ reason: z.string().min(3).max(300) }),
    },
    async (c) => {
      const a = auth(c);
      const { reason } = z.object({ reason: z.string().trim().min(3).max(300) }).parse(await readJson(c));
      const id = c.req.param("id") ?? "";
      const db = controlDb(c.env);
      const target = await db
        .select()
        .from(users)
        .where(and(eq(users.id, id), eq(users.tenantId, a.tenant.id)))
        .get();
      if (!target) throw new AppError(404, "NOT_FOUND", "User not found");
      if (target.id === a.user.id) throw new AppError(422, "SELF_DISABLE", "You cannot disable yourself");
      const now = new Date().toISOString();
      await db.batch([
        db.update(users).set({ status: "DISABLED" }).where(eq(users.id, id)),
        db
          .update(sessions)
          .set({ revokedAt: now, revokedReason: "user-disabled" })
          .where(and(eq(sessions.userId, id), isNull(sessions.revokedAt))),
      ]);
      await audit(db, { actor: a.user.id, action: "user.disable", tenantId: a.tenant.id, userId: id, requestId: c.get("requestId"), detail: { reason } });
      return c.json({ ok: true });
    },
  );

  route(
    app,
    {
      method: "post",
      path: "/admin/users/:id/password",
      summary: "Set a temporary password; the user must change it at next sign-in",
      tag: "admin",
      auth: "bearer",
      permission: "users.manage",
      body: passwordReset,
    },
    async (c) => {
      const a = auth(c);
      const { password } = passwordReset.parse(await readJson(c));
      const id = c.req.param("id") ?? "";
      if (id === a.user.id) throw new AppError(422, "USE_CHANGE_PASSWORD", "Change your own password from your account menu");
      const db = controlDb(c.env);
      const target = await db
        .select()
        .from(users)
        .where(and(eq(users.id, id), eq(users.tenantId, a.tenant.id)))
        .get();
      if (!target) throw new AppError(404, "NOT_FOUND", "User not found");
      const now = new Date().toISOString();
      await db.batch([
        db
          .update(users)
          .set({ passwordHash: await hashPassword(password), mustChangePassword: true, passwordChangedAt: now, failedAttempts: 0, lockedUntil: null })
          .where(eq(users.id, id)),
        db
          .update(sessions)
          .set({ revokedAt: now, revokedReason: "password-reset" })
          .where(and(eq(sessions.userId, id), isNull(sessions.revokedAt))),
      ]);
      await audit(db, { actor: a.user.id, action: "user.password.reset", tenantId: a.tenant.id, userId: id, requestId: c.get("requestId") });
      return c.json({ ok: true });
    },
  );
}
