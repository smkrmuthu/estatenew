import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { api, BOOTSTRAP, mutation, push, setupTenant, today, uniq } from "./helpers";

const platform = (path: string, body?: unknown) => api(path, { method: body === undefined && !path.endsWith("/run") ? "GET" : "POST", body, headers: { "x-platform-token": BOOTSTRAP } });

describe("backups", () => {
  it("makes a verified encrypted copy on request, shows it to the owner only, and keeps sign-in sessions out of the control copy", async () => {
    const s = await setupTenant();
    const none = (await api("/admin/backups", { token: s.owner.token })).body;
    expect(none).toMatchObject({ backups: [], late: true });

    const run = await api("/admin/backups/run", { method: "POST", token: s.owner.token });
    expect(run.status).toBe(201);
    expect(run.body).toMatchObject({ kind: "tenant", trigger: "manual", verified: true });
    expect(run.body.tables.workers).toBe(4);
    expect(run.body.tables.worker_estates).toBe(4);
    expect(run.body.key).toMatch(/\.json\.enc$/);

    const list = (await api("/admin/backups", { token: s.owner.token })).body;
    expect(list.backups).toHaveLength(1);
    expect(list.late).toBe(false);

    // The copy is encrypted: worker names are not readable in the stored file.
    const stored = await env.FILES.get(run.body.key);
    expect(await stored?.text()).not.toContain("Worker A");

    expect((await api("/admin/backups", { token: s.supervisor.token })).status).toBe(403);
    expect((await api("/admin/backups/run", { method: "POST", token: s.supervisor.token })).status).toBe(403);

    expect((await api("/platform/backups/run", { method: "POST" })).status).toBe(403);
    const all = await platform("/platform/backups/run");
    expect(all.status).toBe(200);
    const control = all.body.results.find((r: { kind: string }) => r.kind === "control");
    expect(control.manifest.verified).toBe(true);
    expect(Object.keys(control.manifest.tables)).toEqual(expect.arrayContaining(["tenants", "users", "tenant_domains"]));
    expect(Object.keys(control.manifest.tables)).not.toContain("sessions");
    expect(Object.keys(control.manifest.tables)).not.toContain("refresh_tokens");
    expect(all.body.results.some((r: { code: string; ok: boolean }) => r.code === s.code && r.ok)).toBe(true);
  });

  it("restores a backup into a new empty database that can then be switched in, and never into the live one", async () => {
    const s = await setupTenant();
    const d = today();
    const mark = await mutation(s.supervisor.deviceId, s.estate.id, "attendance_record", "upsert", {
      businessDate: d,
      workerId: s.w1.id,
      statusCode: "PRESENT",
      dayFraction: "FULL",
      fieldId: s.f1.id,
      jobTypeId: s.plk.id,
    });
    const night = await mutation(s.supervisor.deviceId, s.estate.id, "attendance_record", "upsert", {
      businessDate: d,
      shift: "NIGHT",
      workerId: s.w1.id,
      statusCode: "PRESENT",
      dayFraction: "FULL",
      fieldId: s.f1.id,
      jobTypeId: s.plk.id,
    });
    const weigh = await mutation(s.supervisor.deviceId, s.estate.id, "muster_entry", "create", {
      businessDate: d,
      workerId: s.w1.id,
      fieldId: s.f1.id,
      crop: "COFFEE",
      varietyId: s.cg.id,
      grossKg: "20.500",
      bags: 2,
      tareKg: "1",
    });
    expect((await push(s.supervisor, [mark, night, weigh])).body.results.every((r: { status: string }) => r.status === "accepted")).toBe(true);
    const before = (await api("/reference", { token: s.owner.token })).body;
    const sheetBefore = (await api(`/estates/${s.estate.id}/attendance/${d}?shift=NIGHT`, { token: s.supervisor.token })).body;

    expect((await platform("/platform/backups/run")).status).toBe(200);
    const live = await env.CONTROL_DB.prepare("SELECT db_name FROM tenants WHERE code = ?").bind(s.code).first<{ db_name: string }>();
    expect((await platform(`/platform/tenants/${s.code}/restore`, { targetDbName: live?.db_name })).status).toBe(422);
    expect((await platform(`/platform/tenants/${s.code}/restore`, { targetDbName: "x" })).status).toBeGreaterThanOrEqual(400);

    const target = uniq("restore-")
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .padEnd(12, "0");
    const done = await platform(`/platform/tenants/${s.code}/restore`, { targetDbName: target });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body.tables).toMatchObject({ workers: 4, attendance_records: 2, muster_entries: 1 });
    expect(done.body.switchOver).toContain(target);

    // A database that already holds data refuses a second restore.
    expect((await platform(`/platform/tenants/${s.code}/restore`, { targetDbName: target })).status).toBe(409);

    // Switch the tenant to the restored copy: the same lists, register and weigh-in come back.
    await env.CONTROL_DB.prepare("UPDATE tenants SET db_name = ? WHERE code = ?").bind(target, s.code).run();
    const after = (await api("/reference", { token: s.owner.token })).body;
    expect(after.workers.map((w: { employeeCode: string }) => w.employeeCode).sort()).toEqual(before.workers.map((w: { employeeCode: string }) => w.employeeCode).sort());
    expect(after.fields).toHaveLength(before.fields.length);
    const sheetAfter = (await api(`/estates/${s.estate.id}/attendance/${d}?shift=NIGHT`, { token: s.supervisor.token })).body;
    expect(sheetAfter.records).toEqual(sheetBefore.records);
  });
});
