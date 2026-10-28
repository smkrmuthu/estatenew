import type { LoginRequest, SessionResponse } from "@cemms/contracts";
import { type Grant, type Role, requiresMfa, uuidv7 } from "@cemms/domain";
import { and, eq, isNull } from "drizzle-orm";
import { type ControlDb, controlDb } from "../control/db";
import { devices, platformAudit, refreshTokens, sessions, tenants, userGrants, users } from "../control/schema";
import { base32Encode, decryptSecret, dummyPasswordHash, encryptSecret, randomBytes, randomToken, sha256Hex, signJwt, verifyPassword, verifyTotp } from "../core/crypto";
import { AppError, unauthorized } from "../core/errors";
import { tenantForHost } from "../core/site";
import { tenantStub } from "../core/tenant-stub";

export const ACCESS_TOKEN_SECONDS = 15 * 60;
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_MINUTES = 15;
export const REFRESH_COOKIE = "cemms_rt";

const invalid = () => new AppError(401, "INVALID_CREDENTIALS", "The group code, user name or password is not right");

export function grantsOf(rows: (typeof userGrants.$inferSelect)[]): Grant[] {
  return rows.map((g) => ({ role: g.role as Role, estateId: g.estateKey === "" ? null : g.estateKey }));
}

export async function audit(db: ControlDb, entry: { actor: string; action: string; tenantId?: string | null; userId?: string | null; requestId?: string; detail?: unknown }) {
  await db.insert(platformAudit).values({
    id: uuidv7(),
    at: new Date().toISOString(),
    actor: entry.actor,
    action: entry.action,
    tenantId: entry.tenantId ?? null,
    userId: entry.userId ?? null,
    requestId: entry.requestId ?? null,
    detailJson: entry.detail === undefined ? null : JSON.stringify(entry.detail),
  });
}

export type LoginOutcome =
  | { kind: "session"; body: SessionResponse; refreshToken: string; refreshExpires: Date }
  | { kind: "mfa"; body: { mfa: "required" | "enrol"; secret?: string; otpauthUri?: string } };

/** Where the request came from: tokens are bound to the origin, the host decides the tenant. */
export interface Site {
  url: string;
  origin: string;
}

export async function login(env: Env, input: LoginRequest, requestId: string, site: Site): Promise<LoginOutcome> {
  const db = controlDb(env);
  // On a tenant's own address the address decides the tenant; elsewhere the group code is needed.
  const hostTenant = await tenantForHost(env, site.url);
  if (!hostTenant && !input.tenant) throw new AppError(422, "TENANT_REQUIRED", "Enter your estate group code", { tenant: "Required" });
  const tenant = hostTenant
    ? input.tenant && input.tenant !== hostTenant.code
      ? undefined
      : hostTenant
    : await db
        .select()
        .from(tenants)
        .where(eq(tenants.code, input.tenant ?? ""))
        .get();
  const user = tenant
    ? await db
        .select()
        .from(users)
        .where(and(eq(users.tenantId, tenant.id), eq(users.username, input.username)))
        .get()
    : undefined;
  if (tenant?.status !== "ACTIVE" || !user || user.status !== "ACTIVE") {
    await verifyPassword(input.password, await dummyPasswordHash()); // same work either way
    throw invalid();
  }
  const now = new Date();
  if (user.lockedUntil && new Date(user.lockedUntil) > now) throw new AppError(423, "ACCOUNT_LOCKED", `Too many attempts. Try again after ${LOCKOUT_MINUTES} minutes.`);
  if (!(await verifyPassword(input.password, user.passwordHash))) {
    const failed = user.failedAttempts + 1;
    const lockedUntil = failed >= MAX_FAILED_ATTEMPTS ? new Date(now.getTime() + LOCKOUT_MINUTES * 60_000).toISOString() : null;
    await db
      .update(users)
      .set({ failedAttempts: lockedUntil ? 0 : failed, lockedUntil })
      .where(eq(users.id, user.id));
    await audit(db, { actor: user.id, action: lockedUntil ? "auth.locked" : "auth.failed", tenantId: tenant.id, userId: user.id, requestId });
    throw invalid();
  }

  const grants = grantsOf(await db.select().from(userGrants).where(eq(userGrants.userId, user.id)).all());
  if (grants.length === 0) throw new AppError(403, "NO_ACCESS", "This user has no access yet. Ask the owner to give access.");

  let mfaVerified = false;
  if (requiresMfa(grants)) {
    if (!user.mfaEnabled) {
      let secret = user.mfaSecretEnc ? await decryptSecret(user.mfaSecretEnc, env.MFA_ENC_KEY) : null;
      if (!secret) {
        secret = base32Encode(randomBytes(20));
        await db
          .update(users)
          .set({ mfaSecretEnc: await encryptSecret(secret, env.MFA_ENC_KEY) })
          .where(eq(users.id, user.id));
      }
      if (!input.totp) {
        const label = encodeURIComponent(`CEMMS:${tenant.code}/${user.username}`);
        return { kind: "mfa", body: { mfa: "enrol", secret, otpauthUri: `otpauth://totp/${label}?secret=${secret}&issuer=CEMMS&algorithm=SHA1&digits=6&period=30` } };
      }
      const step = await verifyTotp(secret, input.totp, null);
      if (step === null) throw new AppError(401, "MFA_INVALID", "The code is not right. Check the time on your phone and try again.");
      await db.update(users).set({ mfaEnabled: true, mfaLastStep: step }).where(eq(users.id, user.id));
      await audit(db, { actor: user.id, action: "auth.mfa.enrolled", tenantId: tenant.id, userId: user.id, requestId });
    } else {
      if (!input.totp) return { kind: "mfa", body: { mfa: "required" } };
      const secret = await decryptSecret(user.mfaSecretEnc ?? "", env.MFA_ENC_KEY);
      const step = await verifyTotp(secret, input.totp, user.mfaLastStep ?? null);
      if (step === null) throw new AppError(401, "MFA_INVALID", "The code is not right. Check the time on your phone and try again.");
      await db.update(users).set({ mfaLastStep: step }).where(eq(users.id, user.id));
    }
    mfaVerified = true;
  }

  const device = await db.select().from(devices).where(eq(devices.id, input.deviceId)).get();
  if (device && device.tenantId !== tenant.id) throw new AppError(403, "DEVICE_OTHER_TENANT", "This device is registered to another estate group.");
  if (device?.revokedAt) throw new AppError(403, "DEVICE_REVOKED", "This device cannot be used. Ask the owner.");
  if (device)
    await db
      .update(devices)
      .set({ userId: user.id, lastSeenAt: now.toISOString(), label: input.deviceLabel ?? device.label })
      .where(eq(devices.id, device.id));
  else await db.insert(devices).values({ id: input.deviceId, tenantId: tenant.id, userId: user.id, label: input.deviceLabel ?? null, createdAt: now.toISOString(), lastSeenAt: now.toISOString() });

  const hours = await tenantStub(env, tenant.dbName).sessionHours(tenant.id);
  const session = {
    id: uuidv7(),
    tenantId: tenant.id,
    userId: user.id,
    deviceId: input.deviceId,
    mfaVerified,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + hours * 3_600_000).toISOString(),
  };
  await db.insert(sessions).values(session);
  await db.update(users).set({ failedAttempts: 0, lockedUntil: null }).where(eq(users.id, user.id));
  const issued = await issueTokens(env, db, session, user, tenant, grants, site.origin);
  await audit(db, { actor: user.id, action: "auth.login", tenantId: tenant.id, userId: user.id, requestId, detail: { sessionId: session.id, deviceId: input.deviceId } });
  return { kind: "session", ...issued };
}

async function issueTokens(
  env: Env,
  db: ControlDb,
  session: typeof sessions.$inferInsert & { id: string; expiresAt: string },
  user: typeof users.$inferSelect,
  tenant: typeof tenants.$inferSelect,
  grants: Grant[],
  audience: string,
) {
  const nowSec = Math.floor(Date.now() / 1000);
  const exp = Math.min(nowSec + ACCESS_TOKEN_SECONDS, Math.floor(new Date(session.expiresAt).getTime() / 1000));
  const accessToken = await signJwt({ sub: user.id, tid: tenant.id, sid: session.id, did: session.deviceId, iat: nowSec, exp, iss: "cemms", aud: audience }, env.JWT_SECRET);
  const refreshToken = randomToken(32);
  await db.insert(refreshTokens).values({ tokenHash: await sha256Hex(refreshToken), sessionId: session.id, createdAt: new Date().toISOString(), expiresAt: session.expiresAt });
  const body: SessionResponse = {
    accessToken,
    expiresAt: new Date(exp * 1000).toISOString(),
    sessionExpiresAt: session.expiresAt,
    user: { id: user.id, username: user.username, displayName: user.displayName, tenantId: tenant.id, tenantName: tenant.name, grants },
  };
  return { body, refreshToken, refreshExpires: new Date(session.expiresAt) };
}

/** Rotate the refresh token. Presenting a spent token revokes the whole session. */
export async function refresh(env: Env, token: string, requestId: string, site: Site) {
  const db = controlDb(env);
  const row = await db
    .select()
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, await sha256Hex(token)))
    .get();
  if (!row) throw unauthorized();
  const session = await db.select().from(sessions).where(eq(sessions.id, row.sessionId)).get();
  if (!session) throw unauthorized();
  if (row.usedAt) {
    await db.update(sessions).set({ revokedAt: new Date().toISOString(), revokedReason: "refresh-token-reuse" }).where(eq(sessions.id, session.id));
    await audit(db, { actor: session.userId, action: "auth.refresh.reuse", tenantId: session.tenantId, userId: session.userId, requestId, detail: { sessionId: session.id } });
    throw unauthorized("Your session was ended for safety. Sign in again.");
  }
  if (session.revokedAt || new Date(session.expiresAt) <= new Date() || new Date(row.expiresAt) <= new Date()) throw unauthorized();
  const [user, tenant, device] = await Promise.all([
    db.select().from(users).where(eq(users.id, session.userId)).get(),
    db.select().from(tenants).where(eq(tenants.id, session.tenantId)).get(),
    db.select().from(devices).where(eq(devices.id, session.deviceId)).get(),
  ]);
  if (user?.status !== "ACTIVE" || !tenant || tenant.status !== "ACTIVE" || !device || device.revokedAt) throw unauthorized();
  const hostTenant = await tenantForHost(env, site.url);
  if (hostTenant && hostTenant.id !== tenant.id) throw unauthorized();
  // Mark spent only if still unspent: a concurrent second use loses and counts as reuse.
  const marked = await db
    .update(refreshTokens)
    .set({ usedAt: new Date().toISOString() })
    .where(and(eq(refreshTokens.tokenHash, row.tokenHash), isNull(refreshTokens.usedAt)))
    .returning();
  if (marked.length === 0) {
    await db.update(sessions).set({ revokedAt: new Date().toISOString(), revokedReason: "refresh-token-reuse" }).where(eq(sessions.id, session.id));
    throw unauthorized("Your session was ended for safety. Sign in again.");
  }
  const grants = grantsOf(await db.select().from(userGrants).where(eq(userGrants.userId, user.id)).all());
  return issueTokens(env, db, session, user, tenant, grants, site.origin);
}

export async function revokeSession(env: Env, sessionId: string, reason: string) {
  const db = controlDb(env);
  await db.update(sessions).set({ revokedAt: new Date().toISOString(), revokedReason: reason }).where(eq(sessions.id, sessionId));
}
