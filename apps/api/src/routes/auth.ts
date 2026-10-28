import { loginRequest, passwordChange } from "@cemms/contracts";
import { eq } from "drizzle-orm";
import type { Context, Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { requireAuth } from "../auth/middleware";
import { audit, login, REFRESH_COOKIE, refresh, revokeSession } from "../auth/service";
import { controlDb } from "../control/db";
import { users } from "../control/schema";
import { hashPassword, verifyPassword } from "../core/crypto";
import { AppError } from "../core/errors";
import { clientIp, rateLimit, readJson } from "../core/http";
import { route } from "../core/registry";
import { siteOrigin, tenantForHost } from "../core/site";
import type { AppEnv } from "../core/types";

const cookieOptions = (c: Context<AppEnv>, expires: Date) => ({
  httpOnly: true,
  secure: c.env.ENVIRONMENT !== "development" || new URL(c.req.url).protocol === "https:",
  sameSite: "Strict" as const,
  path: "/api/v1/auth",
  expires,
});

/** Cookie-authenticated calls need the custom header (CSRF) and, from browsers, our origin. */
function requireCsrf(c: Context<AppEnv>) {
  if (c.req.header("x-cemms-csrf") !== "1") throw new AppError(403, "CSRF", "Request refused");
  const origin = c.req.header("origin");
  if (origin && origin !== c.env.APP_ORIGIN && origin !== new URL(c.req.url).origin) throw new AppError(403, "CSRF", "Request refused");
}

export function authRoutes(app: Hono<AppEnv>) {
  app.use(
    "/auth/login",
    rateLimit("LOGIN_LIMIT", (c) => `ip:${clientIp(c)}`),
  );
  route(app, { method: "post", path: "/auth/login", summary: "Sign in", tag: "auth", auth: "none", body: loginRequest }, async (c) => {
    const body = loginRequest.parse(await readJson(c));
    const limiter = c.env.LOGIN_LIMIT;
    if (limiter && !(await limiter.limit({ key: `user:${body.tenant ?? new URL(c.req.url).hostname}/${body.username}` })).success)
      throw new AppError(429, "RATE_LIMITED", "Too many attempts. Wait a minute and try again.");
    const result = await login(c.env, body, c.get("requestId"), { url: c.req.url, origin: siteOrigin(c) });
    if (result.kind === "mfa") return c.json(result.body, 200);
    setCookie(c, REFRESH_COOKIE, result.refreshToken, cookieOptions(c, result.refreshExpires));
    return c.json(result.body);
  });

  route(app, { method: "get", path: "/site", summary: "Which tenant this address belongs to (so sign-in needs no group code)", tag: "auth", auth: "none" }, async (c) => {
    const tenant = await tenantForHost(c.env, c.req.url);
    c.header("cache-control", "no-store");
    return c.json({ tenant: tenant && tenant.status === "ACTIVE" ? { code: tenant.code, name: tenant.name } : null });
  });

  route(app, { method: "post", path: "/auth/refresh", summary: "Get a new access token (rotates the refresh cookie)", tag: "auth", auth: "refresh-cookie" }, async (c) => {
    requireCsrf(c);
    const token = getCookie(c, REFRESH_COOKIE);
    if (!token) throw new AppError(401, "UNAUTHENTICATED", "Sign in again");
    const issued = await refresh(c.env, token, c.get("requestId"), { url: c.req.url, origin: siteOrigin(c) });
    setCookie(c, REFRESH_COOKIE, issued.refreshToken, cookieOptions(c, issued.refreshExpires));
    return c.json(issued.body);
  });

  app.use("/auth/logout", requireAuth);
  route(app, { method: "post", path: "/auth/logout", summary: "End this session", tag: "auth", auth: "bearer" }, async (c) => {
    requireCsrf(c);
    const auth = c.get("auth");
    if (auth) {
      await revokeSession(c.env, auth.session.id, "logout");
      await audit(controlDb(c.env), { actor: auth.user.id, action: "auth.logout", tenantId: auth.tenant.id, userId: auth.user.id, requestId: c.get("requestId") });
    }
    deleteCookie(c, REFRESH_COOKIE, { path: "/api/v1/auth" });
    return c.json({ ok: true });
  });

  app.use("/auth/me", requireAuth);
  route(app, { method: "get", path: "/auth/me", summary: "Who am I", tag: "auth", auth: "bearer" }, (c) => {
    const a = c.get("auth");
    if (!a) throw new AppError(401, "UNAUTHENTICATED", "Sign in again");
    return c.json({
      id: a.user.id,
      username: a.user.username,
      displayName: a.user.displayName,
      tenantId: a.tenant.id,
      tenantName: a.tenant.name,
      grants: a.grants,
      sessionExpiresAt: a.session.expiresAt,
      mustChangePassword: a.user.mustChangePassword,
    });
  });

  app.use("/auth/password", requireAuth);
  route(app, { method: "post", path: "/auth/password", summary: "Change my password", tag: "auth", auth: "bearer", body: passwordChange }, async (c) => {
    const a = c.get("auth");
    if (!a) throw new AppError(401, "UNAUTHENTICATED", "Sign in again");
    const body = passwordChange.parse(await readJson(c));
    if (!(await verifyPassword(body.currentPassword, a.user.passwordHash))) throw new AppError(422, "PASSWORD_WRONG", "The current password is not right", { currentPassword: "Not right" });
    const db = controlDb(c.env);
    await db
      .update(users)
      .set({ passwordHash: await hashPassword(body.newPassword), passwordChangedAt: new Date().toISOString(), mustChangePassword: false })
      .where(eq(users.id, a.user.id));
    await audit(db, { actor: a.user.id, action: "auth.password.change", tenantId: a.tenant.id, userId: a.user.id, requestId: c.get("requestId") });
    return c.json({ ok: true });
  });
}
