import { parseMfaRoles, requiresMfa } from "@cemms/domain";
import { eq } from "drizzle-orm";
import type { MiddlewareHandler } from "hono";
import { controlDb } from "../control/db";
import { devices, sessions, tenants, userGrants, users } from "../control/schema";
import { verifyJwt } from "../core/crypto";
import { AppError, unauthorized } from "../core/errors";
import { siteOrigin } from "../core/site";
import type { AppEnv } from "../core/types";
import { grantsOf } from "./service";

/**
 * Verify the bearer token and re-check the session, user, device and tenant on every
 * request, so revocation and grant changes take effect at once (fail closed).
 */
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const header = c.req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const claims = token ? await verifyJwt(token, c.env.JWT_SECRET, siteOrigin(c)) : null;
  if (!claims) throw unauthorized();
  const db = controlDb(c.env);
  const [session, user, tenant, device, grantRows] = await db.batch([
    db.select().from(sessions).where(eq(sessions.id, claims.sid)),
    db.select().from(users).where(eq(users.id, claims.sub)),
    db.select().from(tenants).where(eq(tenants.id, claims.tid)),
    db.select().from(devices).where(eq(devices.id, claims.did)),
    db.select().from(userGrants).where(eq(userGrants.userId, claims.sub)),
  ]);
  const s = session[0];
  const u = user[0];
  const t = tenant[0];
  const d = device[0];
  if (!s || s.revokedAt || new Date(s.expiresAt) <= new Date() || s.userId !== claims.sub || s.tenantId !== claims.tid || s.deviceId !== claims.did) throw unauthorized();
  if (u?.status !== "ACTIVE" || u.tenantId !== claims.tid) throw unauthorized();
  if (t?.status !== "ACTIVE") throw unauthorized();
  if (!d || d.revokedAt || d.tenantId !== claims.tid) throw unauthorized();
  const grants = grantsOf(grantRows.filter((g) => g.tenantId === claims.tid));
  if (requiresMfa(grants, parseMfaRoles(c.env.MFA_ROLES)) && !s.mfaVerified) throw new AppError(401, "MFA_REQUIRED", "Sign in again with your authenticator code");
  c.set("auth", { user: u, tenant: t, session: s, grants });
  await next();
};
