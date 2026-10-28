import { uuidv7 } from "@cemms/domain";
import { describe, expect, it } from "vitest";
import { api, BOOTSTRAP, uniq } from "./helpers";

async function tenantWithDomain(domain: string) {
  const code = uniq("s");
  const res = await api("/platform/tenants", {
    body: { code, name: `Site ${code}`, owner: { username: "owner", displayName: "O", password: "owner-password-123" }, domains: [domain] },
    headers: { "x-platform-token": BOOTSTRAP },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  // A supervisor (no MFA) to sign in with.
  return code;
}

describe("site address decides the tenant", () => {
  it("names the tenant for its address and none for a generic address", async () => {
    const host = `${uniq("g")}.example.com`;
    const code = await tenantWithDomain(host);
    expect((await api("/site", { host })).body.tenant).toMatchObject({ code });
    expect((await api("/site")).body.tenant).toBeNull();
  });

  it("signs in without a group code on the tenant's address, and needs one elsewhere", async () => {
    const host = `${uniq("g")}.example.com`;
    const code = await tenantWithDomain(host);
    const onSite = await api("/auth/login", { host, body: { username: "owner", password: "owner-password-123", deviceId: uuidv7() } });
    expect(onSite.status).toBe(200);
    expect(onSite.body.mfa).toBe("enrol");
    const generic = await api("/auth/login", { body: { username: "owner", password: "owner-password-123", deviceId: uuidv7() } });
    expect(generic.body.code).toBe("TENANT_REQUIRED");
    // A different group code on a tenant's address is refused like a wrong password.
    const other = await api("/auth/login", { host, body: { tenant: "someone-else", username: "owner", password: "owner-password-123", deviceId: uuidv7() } });
    expect(other.status).toBe(401);
    expect(code).toBeTruthy();
  });

  it("refuses an address that already belongs to another tenant", async () => {
    const host = `${uniq("g")}.example.com`;
    await tenantWithDomain(host);
    const second = await api("/platform/tenants", {
      body: { code: uniq("s"), name: "Second", owner: { username: "owner", displayName: "O", password: "owner-password-123" }, domains: [host] },
      headers: { "x-platform-token": BOOTSTRAP },
    });
    expect(second.body.code).toBe("DOMAIN_TAKEN");
    expect((await api(`/platform/tenants/nope/domains`, { body: { domain: "x.example.com" }, headers: { "x-platform-token": BOOTSTRAP } })).status).toBe(404);
    expect((await api(`/platform/tenants/nope/domains`, { body: { domain: "not a host" }, headers: { "x-platform-token": BOOTSTRAP } })).status).toBe(422);
  });
});
