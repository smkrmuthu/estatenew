import { uuidv7 } from "@cemms/domain";
import { describe, expect, it } from "vitest";
import { signJwt } from "../src/core/crypto";
import { api, cookieFrom, createTenant, login, ORIGIN, setupTenant } from "./helpers";

describe("authentication", () => {
  it("refuses wrong credentials with one generic message and locks after 5 failures", async () => {
    const t = await createTenant();
    const bad = (username: string) => api("/auth/login", { body: { tenant: t.code, username, password: "wrong-password", deviceId: uuidv7() } });
    const unknown = await bad("nobody");
    const wrong = await bad("owner");
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.body.title).toBe(wrong.body.title);
    for (let i = 0; i < 4; i++) await bad("owner");
    const locked = await api("/auth/login", { body: { tenant: t.code, username: "owner", password: t.owner.password, deviceId: uuidv7() } });
    expect(locked.status).toBe(423);
    expect(locked.body.code).toBe("ACCOUNT_LOCKED");
  });

  it("requires MFA enrolment for owners and returns no session until the code is given", async () => {
    const t = await createTenant();
    const first = await api("/auth/login", { body: { tenant: t.code, username: "owner", password: t.owner.password, deviceId: uuidv7() } });
    expect(first.status).toBe(200);
    expect(first.body.mfa).toBe("enrol");
    expect(first.body.accessToken).toBeUndefined();
    expect(first.headers.get("set-cookie")).toBeNull();
    const bad = await api("/auth/login", { body: { tenant: t.code, username: "owner", password: t.owner.password, deviceId: uuidv7(), totp: "000000" } });
    expect(bad.status).toBe(401);
    const ok = await login(t.code, "owner", t.owner.password);
    expect(ok.user.grants).toEqual([{ role: "OWNER", estateId: null }]);
  });

  it("rotates refresh tokens and revokes the session when a spent token is reused", async () => {
    const s = await setupTenant();
    const csrf = { "x-cemms-csrf": "1", origin: ORIGIN };
    const noCsrf = await api("/auth/refresh", { method: "POST", cookie: s.supervisor.cookie });
    expect(noCsrf.status).toBe(403);
    const r1 = await api("/auth/refresh", { method: "POST", cookie: s.supervisor.cookie, headers: csrf });
    expect(r1.status).toBe(200);
    const next = cookieFrom(r1);
    expect(next).not.toBe(s.supervisor.cookie);
    const reuse = await api("/auth/refresh", { method: "POST", cookie: s.supervisor.cookie, headers: csrf });
    expect(reuse.status).toBe(401);
    // The whole session is gone: the rotated token and the access token stop working.
    expect((await api("/auth/refresh", { method: "POST", cookie: next, headers: csrf })).status).toBe(401);
    expect((await api("/auth/me", { token: r1.body.accessToken })).status).toBe(401);
  });

  it("sets a safe refresh cookie", async () => {
    const s = await setupTenant();
    const res = await api("/auth/login", { body: { tenant: s.code, username: "sup1", password: "supervisor-pass-1", deviceId: uuidv7() } });
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Path=\/api\/v1\/auth/);
  });

  it("logout ends the session", async () => {
    const s = await setupTenant();
    expect((await api("/auth/logout", { method: "POST", token: s.supervisor.token, headers: { "x-cemms-csrf": "1" } })).status).toBe(200);
    expect((await api("/auth/me", { token: s.supervisor.token })).status).toBe(401);
  });

  it("rejects forged, expired and wrong-audience tokens", async () => {
    const s = await setupTenant();
    const [h, body] = s.supervisor.token.split(".");
    expect((await api("/auth/me", { token: `${h}.${body}.forged` })).status).toBe(401);
    const now = Math.floor(Date.now() / 1000);
    const claims = JSON.parse(atob((body ?? "").replaceAll("-", "+").replaceAll("_", "/")));
    const wrongKey = await signJwt({ ...claims, exp: now + 600 }, "some-other-secret-0123456789abcdef");
    expect((await api("/auth/me", { token: wrongKey })).status).toBe(401);
    const expired = await signJwt({ ...claims, exp: now - 1 }, "test-only-jwt-secret-0123456789abcdef0123456789");
    expect((await api("/auth/me", { token: expired })).status).toBe(401);
    const otherAud = await signJwt({ ...claims, aud: "https://evil.example" }, "test-only-jwt-secret-0123456789abcdef0123456789");
    expect((await api("/auth/me", { token: otherAud })).status).toBe(401);
  });

  it("disabling a user ends their sessions at once", async () => {
    const s = await setupTenant();
    const users = (await api("/admin/users", { token: s.owner.token })).body as { id: string; username: string }[];
    const sup = users.find((u) => u.username === "sup1");
    expect((await api(`/admin/users/${sup?.id}/disable`, { token: s.owner.token, body: { reason: "Left the estate" } })).status).toBe(200);
    expect((await api("/auth/me", { token: s.supervisor.token })).status).toBe(401);
  });

  it("refuses requests from other sites and the platform endpoint without the bootstrap token", async () => {
    const s = await setupTenant();
    const cross = await api("/auth/me", { token: s.owner.token, headers: { origin: "https://evil.example" } });
    expect(cross.status).toBe(403);
    const noToken = await api("/platform/tenants", { body: { code: "x1", name: "X", owner: { username: "o", displayName: "O", password: "password-123456" } } });
    expect(noToken.status).toBe(403);
  });
});
