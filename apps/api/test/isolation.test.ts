import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { controlDb } from "../src/control/db";
import { tenants } from "../src/control/schema";
import { tenantStub } from "../src/core/tenant-stub";
import { api, mutation, push, setupTenant, today } from "./helpers";

describe("tenant and estate isolation", () => {
  it("a user of tenant B cannot reach tenant A's data through any route", async () => {
    const a = await setupTenant();
    const b = await setupTenant();
    const d = today();
    // Tenant A has data.
    const m = await mutation(a.supervisor.deviceId, a.estate.id, "attendance_record", "upsert", {
      businessDate: d,
      workerId: a.w1.id,
      statusCode: "PRESENT",
      dayFraction: "FULL",
      fieldId: a.f1.id,
      jobTypeId: a.plk.id,
    });
    expect((await push(a.supervisor, [m])).body.results[0].status).toBe("accepted");

    const aUserId = ((await api("/admin/users", { token: a.owner.token })).body as { id: string }[])[0]?.id ?? "";
    const attempts: [string, string, unknown?][] = [
      ["GET", `/estates/${a.estate.id}/attendance/${d}`],
      ["GET", `/estates/${a.estate.id}/muster/${d}`],
      ["GET", `/estates/${a.estate.id}/daily-log/${d}`],
      ["GET", `/estates/${a.estate.id}/reports/daily/${d}`],
      ["GET", `/estates/${a.estate.id}/reports/dashboard/${d}`],
      ["GET", `/estates/${a.estate.id}/reports/plucking?from=${d}&to=${d}`],
      ["GET", `/estates/${a.estate.id}/daily-log?from=${d}&to=${d}`],
      ["GET", `/estates/${a.estate.id}/workers/${a.w1.id}/attendance`],
      ["PUT", `/admin/users/${aUserId}`, { displayName: "Taken over", grants: [{ role: "OWNER", estateId: null }] }],
      ["POST", `/admin/users/${aUserId}/enable`],
      ["GET", `/estates/${a.estate.id}/conflicts`],
      ["POST", `/estates/${a.estate.id}/attendance/${d}/actions`, { action: "approve" }],
      ["POST", `/attendance-records/${m.entityId}/corrections`, { statusCode: "ABSENT", reason: "test reason", baseVersion: 1 }],
      ["PUT", `/fields/${a.f1.id}`, { estateId: a.estate.id, code: "F1", name: "x", crops: ["COFFEE"], varietyIds: [] }],
      ["PUT", `/workers/${a.w1.id}`, { estateId: a.estate.id, employeeCode: "W001", name: "x" }],
      ["POST", `/workers/${a.w1.id}/delete`, { reason: "test reason" }],
      ["POST", `/fields/${a.f1.id}/delete`, { reason: "test reason" }],
      ["GET", `/audit?estateId=${a.estate.id}`],
      ["GET", `/audit/history?entityType=attendance_record&entityId=${m.entityId}&estateId=${a.estate.id}`],
    ];
    for (const [method, path, body] of attempts) {
      const res = await api(path, { method, token: b.owner.token, body });
      expect([403, 404, 422], `${method} ${path} -> ${res.status} ${JSON.stringify(res.body)}`).toContain(res.status);
      expect(JSON.stringify(res.body)).not.toContain(a.w1.id);
    }
    // Sync into another tenant's estate is refused per item.
    const evil = await mutation(b.supervisor.deviceId, a.estate.id, "attendance_record", "upsert", { businessDate: d, workerId: a.w2.id, statusCode: "ABSENT" });
    const r = await push(b.supervisor, [evil]);
    expect(r.body.results[0].status).toBe("rejected");
    // B's reference data never includes A's estates.
    const ref = (await api("/reference", { token: b.owner.token })).body;
    expect(ref.estates.map((e: { id: string }) => e.id)).not.toContain(a.estate.id);
  });

  it("a supervisor is limited to their estate and cannot approve or manage", async () => {
    const s = await setupTenant();
    const d = today();
    expect((await api(`/estates/${s.estate2.id}/attendance/${d}`, { token: s.supervisor.token })).status).toBe(403);
    expect((await api(`/estates/${s.estate.id}/attendance/${d}/actions`, { token: s.supervisor.token, body: { action: "approve" } })).status).toBe(403);
    expect((await api("/admin/users", { token: s.supervisor.token })).status).toBe(403);
    expect((await api("/imports/preview", { token: s.supervisor.token, body: { kind: "workers", csv: "estate_code,employee_code,name\nGLZ,W9,X\n" } })).status).toBe(403);
    const ref = (await api("/reference", { token: s.supervisor.token })).body;
    expect(ref.estates.map((e: { id: string }) => e.id)).toEqual([s.estate.id]);
    expect(ref.workers.every((w: { estateId: string }) => w.estateId === s.estate.id)).toBe(true);
    const other = await mutation(s.supervisor.deviceId, s.estate2.id, "attendance_record", "upsert", { businessDate: d, workerId: s.w101.id, statusCode: "ABSENT" });
    expect((await push(s.supervisor, [other])).body.results[0]).toMatchObject({ status: "rejected", errorCode: "FORBIDDEN" });
  });

  it("a tenant database refuses a scope for another tenant (defence in depth)", async () => {
    const a = await setupTenant();
    const b = await setupTenant();
    const row = await controlDb(env).select().from(tenants).where(eq(tenants.id, a.tenantId)).get();
    const stub = tenantStub(env, row?.dbName ?? "");
    const res = await stub.run(
      { tenantId: b.tenantId, userId: "u", sessionId: "s", deviceId: "d", grants: [{ role: "OWNER", estateId: null }], requestId: "r", environment: "test" },
      "org.reference",
      {},
    );
    expect(res).toMatchObject({ ok: false, error: { code: "TENANT_MISMATCH" } });
    const again = await stub.provision({ tenantId: b.tenantId, actor: "x", seedGatesFromRegister: false });
    expect(again).toMatchObject({ ok: false, error: { code: "TENANT_MISMATCH" } });
    const health = await stub.health();
    expect(health.migration).toMatchObject({ version: 3, error: null });
    expect(health.provisioned).toBe(true);
  });
});
