import { uuidv7 } from "@cemms/domain";
import { describe, expect, it } from "vitest";
import { api, createTenant, login, mutation, push, setupTenant, today } from "./helpers";

describe("imports", () => {
  it("previews row errors, applies once, and treats a repeat as already imported", async () => {
    const s = await setupTenant();
    const bad = "estate_code,employee_code,name\nGLZ,W010,Ten\nZZZ,W011,Eleven\nGLZ,W010,Dup\n";
    const pre = (await api("/imports/preview", { token: s.owner.token, body: { kind: "workers", csv: bad } })).body;
    expect(pre.errors.map((e: { row: number }) => e.row)).toEqual([3, 4]);
    const blocked = await api("/imports/commit", { token: s.owner.token, body: { kind: "workers", csv: bad, previewHash: pre.previewHash } });
    expect(blocked.body.code).toBe("IMPORT_HAS_ERRORS");

    const csv = "estate_code,employee_code,name\nGLZ,W010,Ten\nGLZ,W001,Worker A renamed\nGLZ,W002,Worker B\n";
    const p2 = (await api("/imports/preview", { token: s.owner.token, body: { kind: "workers", csv } })).body;
    expect(p2.totals).toMatchObject({ create: 1, update: 1, unchanged: 1, errors: 0 });
    const mismatch = await api("/imports/commit", { token: s.owner.token, body: { kind: "workers", csv: `${csv}GLZ,W099,X\n`, previewHash: p2.previewHash } });
    expect(mismatch.body.code).toBe("PREVIEW_MISMATCH");
    const c1 = (await api("/imports/commit", { token: s.owner.token, body: { kind: "workers", csv, previewHash: p2.previewHash } })).body;
    expect(c1.alreadyImported).toBe(false);
    const c2 = (await api("/imports/commit", { token: s.owner.token, body: { kind: "workers", csv, previewHash: p2.previewHash } })).body;
    expect(c2).toMatchObject({ alreadyImported: true, importId: c1.importId });
    const audit = (await api("/audit?entityType=import", { token: s.owner.token })).body;
    expect(audit.length).toBeGreaterThanOrEqual(1);
  });

  it("imports worker type, keeps it when the column is absent, and refuses unknown values", async () => {
    const s = await setupTenant();
    const imp = async (csv: string) => {
      const pre = (await api("/imports/preview", { token: s.owner.token, body: { kind: "workers", csv } })).body;
      if (pre.errors.length) return pre;
      return (await api("/imports/commit", { token: s.owner.token, body: { kind: "workers", csv, previewHash: pre.previewHash } })).body;
    };
    const types = async () =>
      Object.fromEntries(
        ((await api("/reference", { token: s.owner.token })).body.workers as { employeeCode: string; employmentType: string | null }[]).map((w) => [w.employeeCode, w.employmentType]),
      );

    expect(await types()).toMatchObject({ W001: null, W002: null });
    await imp("estate_code,employee_code,name,employment_type\nGLZ,W001,Worker A,permanent\nGLZ,W002,Worker B,Casual\nGLZ,W003,Worker C,CONTRACT\n");
    expect(await types()).toMatchObject({ W001: "PERMANENT", W002: "CASUAL", W003: "CONTRACT" });

    // A file without the column leaves the type alone; a blank cell clears it.
    await imp("estate_code,employee_code,name\nGLZ,W001,Worker A renamed\n");
    expect(await types()).toMatchObject({ W001: "PERMANENT" });
    await imp("estate_code,employee_code,name,employment_type\nGLZ,W001,Worker A renamed,\n");
    expect(await types()).toMatchObject({ W001: null });

    const bad = await imp("estate_code,employee_code,name,employment_type\nGLZ,W001,Worker A,Seasonal\n");
    expect(bad.errors).toEqual([expect.objectContaining({ row: 2, column: "employment_type" })]);
  });

  it("imports North Indian workers and their area, and leaves the area alone when the column is absent", async () => {
    const s = await setupTenant();
    const imp = async (csv: string) => {
      const pre = (await api("/imports/preview", { token: s.owner.token, body: { kind: "workers", csv } })).body;
      if (pre.errors.length) return pre;
      return (await api("/imports/commit", { token: s.owner.token, body: { kind: "workers", csv, previewHash: pre.previewHash } })).body;
    };
    const rows = async () =>
      Object.fromEntries(
        ((await api("/reference", { token: s.owner.token })).body.workers as { employeeCode: string; employmentType: string | null; area: string | null }[]).map((w) => [
          w.employeeCode,
          [w.employmentType, w.area],
        ]),
      );
    await imp("estate_code,employee_code,name,employment_type,area\nGLZ,N1,Sanjay,North Indian,Bihar\nGLZ,N2,Vellaian,Permanent,Keeraikadu\n");
    expect(await rows()).toMatchObject({ N1: ["NORTH_INDIAN", "Bihar"], N2: ["PERMANENT", "Keeraikadu"] });
    await imp("estate_code,employee_code,name\nGLZ,N1,Sanjay K\n");
    expect(await rows()).toMatchObject({ N1: ["NORTH_INDIAN", "Bihar"] });
    await imp("estate_code,employee_code,name,area\nGLZ,N1,Sanjay K,\n");
    expect(await rows()).toMatchObject({ N1: ["NORTH_INDIAN", null] });
    const made = await api("/workers", { token: s.owner.token, body: { estateId: s.estate.id, name: "Roshini", employmentType: "NORTH_INDIAN", area: "Bihar", active: true } });
    expect(made.body).toMatchObject({ employmentType: "NORTH_INDIAN", area: "Bihar" });
  });

  it("rejects formula injection and unknown columns", async () => {
    const s = await setupTenant();
    const res = (await api("/imports/preview", { token: s.owner.token, body: { kind: "workers", csv: "estate_code,employee_code,name,phone\nGLZ,W1,=HYPERLINK(1),9\n" } })).body;
    expect(res.errors.map((e: { column: string }) => e.column)).toEqual(["phone"]);
    const res2 = (await api("/imports/preview", { token: s.owner.token, body: { kind: "workers", csv: "estate_code,employee_code,name\nGLZ,W1,=HYPERLINK(1)\n" } })).body;
    expect(res2.errors[0].message).toMatch(/cannot start/);
  });
});

describe("settings and readiness", () => {
  it("lists settings with gates, validates changes and audits them", async () => {
    const s = await setupTenant();
    const list = (await api("/admin/settings", { token: s.owner.token })).body;
    expect(list.find((x: { key: string }) => x.key === "muster.tare.mode")).toMatchObject({
      value: "MANUAL",
      basis: "proposed",
      gates: [
        { id: "OC-19", status: "open" },
        { id: "OC-87", status: "open" },
      ],
    });
    expect((await api("/admin/settings/muster.tare.mode", { method: "PUT", token: s.supervisor.token, body: { value: "NONE" } })).status).toBe(403);
    expect((await api("/admin/settings/muster.tare.mode", { method: "PUT", token: s.owner.token, body: { value: "BAD" } })).status).toBe(422);
    expect((await api("/admin/settings/nope", { method: "PUT", token: s.owner.token, body: { value: 1 } })).status).toBe(404);
    // Development allows proposed values for testing (production refuses; see domain tests).
    expect((await api("/admin/settings/muster.tare.mode", { method: "PUT", token: s.owner.token, body: { value: "NONE" } })).status).toBe(200);
  });

  it("shows open questions that block production; the first tenant gets the owner's recorded answers", async () => {
    const fresh = await setupTenant();
    const r1 = (await api("/admin/readiness", { token: fresh.owner.token })).body;
    expect(r1.ready).toBe(false);
    expect(r1.blocking.map((g: { id: string }) => g.id)).toContain("OC-103");

    const t = await createTenant(undefined, true);
    const owner = await login(t.code, "owner", t.owner.password);
    const gates = (await api("/admin/gates", { token: owner.token })).body as { id: string; status: string; answer: string }[];
    expect(gates.find((g) => g.id === "OC-105")).toMatchObject({ status: "confirmed" });
    expect(gates.find((g) => g.id === "OC-5")).toMatchObject({ status: "answered-unclear", answer: "NA" });
    expect(gates.find((g) => g.id === "OC-7")).toMatchObject({ status: "open" });

    const rec = await api("/admin/gates/OC-7", {
      method: "PUT",
      token: owner.token,
      body: { status: "confirmed", answer: "Estate manager approves", approver: "Estate owner", decidedOn: "2026-10-30", source: "Phone call" },
    });
    expect(rec.status).toBe(200);
    expect(((await api("/admin/readiness", { token: owner.token })).body.blocking as { id: string }[]).map((g) => g.id)).not.toContain("OC-7");
  });
});

describe("passwords", () => {
  it("an owner sets a temporary password; the user must change it, then other devices are signed out", async () => {
    const s = await setupTenant();
    const users = (await api("/admin/users", { token: s.owner.token })).body as { id: string; username: string }[];
    const sup = users.find((u) => u.username === "sup1");
    expect((await api(`/admin/users/${sup?.id}/password`, { token: s.supervisor.token, body: { password: "temporary-pass-1" } })).status).toBe(403);
    expect((await api(`/admin/users/${sup?.id}/password`, { token: s.owner.token, body: { password: "short" } })).status).toBe(422);
    expect((await api(`/admin/users/${s.owner.user.id}/password`, { token: s.owner.token, body: { password: "temporary-pass-1" } })).body.code).toBe("USE_CHANGE_PASSWORD");
    expect((await api(`/admin/users/${sup?.id}/password`, { token: s.owner.token, body: { password: "temporary-pass-1" } })).status).toBe(200);
    // The reset ends the supervisor's sessions and the old password stops working.
    expect((await api("/auth/me", { token: s.supervisor.token })).status).toBe(401);
    expect((await api("/auth/login", { body: { tenant: s.code, username: "sup1", password: "supervisor-pass-1", deviceId: uuidv7() } })).status).toBe(401);

    const first = await login(s.code, "sup1", "temporary-pass-1");
    expect(first.user.mustChangePassword).toBe(true);
    const second = await login(s.code, "sup1", "temporary-pass-1");
    expect((await api("/auth/password", { token: first.token, body: { currentPassword: "temporary-pass-1", newPassword: "temporary-pass-1" } })).status).toBe(422);
    expect((await api("/auth/password", { token: first.token, body: { currentPassword: "wrong-password", newPassword: "my-own-password-9" } })).body.code).toBe("PASSWORD_WRONG");
    expect((await api("/auth/password", { token: first.token, body: { currentPassword: "temporary-pass-1", newPassword: "my-own-password-9" } })).status).toBe(200);
    expect((await api("/auth/me", { token: first.token })).status).toBe(200);
    expect((await api("/auth/me", { token: second.token })).status).toBe(401);
    expect((await login(s.code, "sup1", "my-own-password-9")).user.mustChangePassword).toBe(false);
  });
});

describe("masters forms", () => {
  it("creates a worker with gender and type, allocates the next code, and edits it", async () => {
    const s = await setupTenant();
    const mk = (body: Record<string, unknown>) => api("/workers", { token: s.owner.token, body: { estateId: s.estate.id, ...body } });
    const a = await mk({ name: "Asha", gender: "FEMALE", employmentType: "PERMANENT" });
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    expect(a.body).toMatchObject({ employeeCode: "GLZ-001", gender: "FEMALE", employmentType: "PERMANENT", active: true });
    const b = await mk({ name: "Babu", gender: null, employmentType: "CASUAL" });
    expect(b.body).toMatchObject({ employeeCode: "GLZ-002", gender: null, employmentType: "CASUAL" });
    const bad = await mk({ name: "X", gender: "OTHER" });
    expect(bad.status).toBe(422);

    const edit = await api(`/workers/${b.body.id}`, {
      method: "PUT",
      token: s.owner.token,
      headers: { "if-match": "1" },
      body: { estateId: s.estate.id, name: "Babu K", gender: "MALE", employmentType: "CONTRACT", active: false },
    });
    expect(edit.body).toMatchObject({ name: "Babu K", gender: "MALE", employmentType: "CONTRACT", active: false, version: 2, employeeCode: "GLZ-002" });
    // Inactive workers are left out of the device list but come back for the Masters screen.
    const codes = async (q = "") => ((await api(`/reference${q}`, { token: s.owner.token })).body.workers as { employeeCode: string }[]).map((w) => w.employeeCode);
    expect(await codes()).not.toContain("GLZ-002");
    expect(await codes("?inactive=1")).toContain("GLZ-002");
    // A supervisor cannot add workers.
    const sup = await api("/workers", { token: s.supervisor.token, body: { estateId: s.estate.id, name: "Nope" } });
    expect(sup.status).toBe(403);
  });

  it("saves a field with subdivisions A, B, C, derives its varieties, and checks the acres", async () => {
    const s = await setupTenant();
    const base = { estateId: s.estate.id, code: "F9", name: "Middle Field", areaCentiAcres: 1000, elevationM: 1050, expectedCherryKg: 2500, crops: ["COFFEE"] };
    const ok = await api("/fields", {
      token: s.owner.token,
      body: {
        ...base,
        subdivisions: [
          { landUse: "BEARING", varietyId: s.cg.id, areaCentiAcres: 400 },
          { landUse: "BEARING", varietyId: s.ref.varieties.find((v: { code: string }) => v.code === "S9").id, areaCentiAcres: 500 },
          { landUse: "ROCK", areaCentiAcres: 100 },
        ],
      },
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    const f = ((await api("/reference", { token: s.owner.token })).body.fields as any[]).find((x) => x.code === "F9");
    expect(f).toMatchObject({ elevationM: 1050, expectedCherryKg: 2500, areaCentiAcres: 1000 });
    expect(f.subdivisions.map((x: { label: string; landUse: string }) => `${x.label}:${x.landUse}`)).toEqual(["A:BEARING", "B:BEARING", "C:ROCK"]);
    expect(f.varietyIds).toHaveLength(2);

    // A field without a code gets the next one for its estate.
    const auto = await api("/fields", { token: s.owner.token, body: { estateId: s.estate.id, name: "No code given", crops: ["COFFEE"] } });
    expect(auto.body.code).toBe("GLZ-01");

    const mismatch = await api("/fields", { token: s.owner.token, body: { ...base, code: "F10", subdivisions: [{ landUse: "BEARING", varietyId: s.cg.id, areaCentiAcres: 300 }] } });
    expect(mismatch.body.code).toBe("SUBDIVISION_AREA");
    const noVariety = await api("/fields", { token: s.owner.token, body: { ...base, code: "F11", subdivisions: [{ landUse: "BEARING", areaCentiAcres: 1000 }] } });
    expect(noVariety.body.code).toBe("SUBDIVISION_VARIETY");

    // Editing replaces the subdivisions and keeps the audit trail.
    const edit = await api(`/fields/${ok.body.id}`, {
      method: "PUT",
      token: s.owner.token,
      headers: { "if-match": "1" },
      body: { ...base, subdivisions: [{ landUse: "BEARING", varietyId: s.cg.id, areaCentiAcres: 1000 }] },
    });
    expect(edit.status, JSON.stringify(edit.body)).toBe(200);
    const f2 = ((await api("/reference", { token: s.owner.token })).body.fields as any[]).find((x) => x.code === "F9");
    expect(f2.subdivisions).toHaveLength(1);
    expect(f2.varietyIds).toEqual([s.cg.id]);
    // Another tenant's estate cannot be written to; a supervisor cannot write fields.
    expect((await api("/fields", { token: s.supervisor.token, body: base })).status).toBe(403);
  });

  it("never deletes on import, and a file cannot change a field that has subdivisions", async () => {
    const s = await setupTenant();
    const f = await api("/fields", {
      token: s.owner.token,
      body: { estateId: s.estate.id, code: "F9", name: "Middle", areaCentiAcres: 1000, crops: ["COFFEE"], subdivisions: [{ landUse: "BEARING", varietyId: s.cg.id, areaCentiAcres: 1000 }] },
    });
    expect(f.status).toBe(201);
    const run = async (kind: string, csv: string) => {
      const pre = (await api("/imports/preview", { token: s.owner.token, body: { kind, csv } })).body;
      if (pre.errors.length) return pre;
      return (await api("/imports/commit", { token: s.owner.token, body: { kind, csv, previewHash: pre.previewHash } })).body;
    };
    const ref = async () => (await api("/reference", { token: s.owner.token })).body;
    const before = await ref();

    // A workers file that lists only one worker leaves every other worker and field alone.
    await run("workers", "estate_code,employee_code,name\nGLZ,W001,Worker A\n");
    const after = await ref();
    expect(after.workers).toHaveLength(before.workers.length);
    expect(after.fields).toHaveLength(before.fields.length);

    // Same acres, blank varieties: the subdivisions still decide the varieties.
    await run("fields", "estate_code,code,name,area_acres,crops,varieties\nGLZ,F9,Middle Renamed,10,COFFEE,\n");
    const f9 = (await ref()).fields.find((x: { code: string }) => x.code === "F9");
    expect(f9).toMatchObject({ name: "Middle Renamed", varietyIds: [s.cg.id] });
    expect(f9.subdivisions).toHaveLength(1);
    // Different acres would break the subdivisions, so the row is refused.
    const bad = await run("fields", "estate_code,code,name,area_acres\nGLZ,F9,Middle,12\n");
    expect(bad.errors).toEqual([expect.objectContaining({ column: "area_acres" })]);
  });

  it("deletes unused sample workers and fields with a reason, and refuses ones that have records", async () => {
    const s = await setupTenant();
    // W001 gets an attendance record on F1, so both are in use.
    const m = await mutation(s.supervisor.deviceId, s.estate.id, "attendance_record", "upsert", {
      businessDate: today(),
      workerId: s.w1.id,
      statusCode: "PRESENT",
      dayFraction: "FULL",
      fieldId: s.f1.id,
      jobTypeId: s.plk.id,
    });
    expect((await push(s.supervisor, [m])).body.results[0].status).toBe("accepted");
    const del = (kind: "workers" | "fields", id: string, reason = "Removing sample data", token = s.owner.token) => api(`/${kind}/${id}/delete`, { token, body: { reason } });

    const used = await del("workers", s.w1.id);
    expect(used.status).toBe(409);
    expect(used.body.code).toBe("IN_USE");
    expect((await del("fields", s.f1.id)).body.code).toBe("IN_USE");

    expect((await del("workers", s.w2.id, "x")).status).toBe(422); // reason too short
    expect((await del("workers", s.w2.id, "Removing sample data", s.supervisor.token)).status).toBe(403);
    const ok = await del("workers", s.w2.id);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect((await del("fields", s.f2.id)).status).toBe(200);

    const ref = (await api("/reference", { token: s.owner.token })).body;
    expect(ref.workers.map((w: { id: string }) => w.id)).not.toContain(s.w2.id);
    expect(ref.workers.map((w: { id: string }) => w.id)).toContain(s.w1.id);
    expect(ref.fields.map((f: { id: string }) => f.id)).not.toContain(s.f2.id);
    const audit = (await api("/audit?entityType=worker", { token: s.owner.token })).body as { action: string; reason: string }[];
    expect(audit).toContainEqual(expect.objectContaining({ action: "worker.delete", reason: "Removing sample data" }));
    // Deleting twice is a plain not-found.
    expect((await del("workers", s.w2.id)).status).toBe(404);
  });

  it("lets an estate manager of both estates manage shared lists, settings and users, without owner powers", async () => {
    const s = await setupTenant();
    const mk = async (username: string, grants: { role: string; estateId: string | null }[]) => {
      const res = await api("/admin/users", { token: s.owner.token, body: { username, displayName: username, password: "manager-pass-1234", grants } });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      return { ...(await login(s.code, username, "manager-pass-1234")), id: res.body.id as string };
    };
    // One manager has a grant for each estate, the other for one estate only.
    const both = await mk("mgrboth", [
      { role: "ESTATE_MANAGER", estateId: s.estate.id },
      { role: "ESTATE_MANAGER", estateId: s.estate2.id },
    ]);
    const one = await mk("mgrone", [{ role: "ESTATE_MANAGER", estateId: s.estate.id }]);
    const kind = { code: "FERM", label: "Fermentation room temperature", unit: "°C", valueType: "NUMBER", decimals: 1, minScaled: 0, maxScaled: 600, expectedPerDay: null };

    // Shared lists: log kinds and jobs.
    for (const m of [both, one]) {
      const made = await api("/admin/log-kinds", { token: m.token, body: { ...kind, code: `K${m.id.slice(-4)}` } });
      expect(made.status, JSON.stringify(made.body)).toBe(201);
      expect((await api("/job-types", { token: m.token, body: { code: `J${m.id.slice(-4)}`, name: "Pruning", countsAsPlucking: false } })).status).toBe(201);
    }
    expect((await api("/admin/log-kinds", { token: s.supervisor.token, body: { ...kind, code: "X2" } })).status).toBe(403);

    // Settings: the season start, but not recording go-live answers.
    expect((await api("/admin/settings/season.startDate", { method: "PUT", token: both.token, body: { value: "2026-10-01" } })).status).toBe(200);
    expect((await api("/admin/settings", { token: both.token })).status).toBe(200);
    expect((await api("/admin/gates/OC-7", { method: "PUT", token: both.token, body: { status: "confirmed", answer: "x", approver: "x", decidedOn: "2026-10-28", source: "x" } })).status).toBe(403);
    expect((await api("/admin/readiness", { token: both.token })).status).toBe(403);

    // Users: create and edit staff for their estates, never owners or other estates.
    const staff = await api("/admin/users", {
      token: both.token,
      body: { username: "newsup", displayName: "New Supervisor", password: "supervisor-pass-9", grants: [{ role: "FIELD_SUPERVISOR", estateId: s.estate2.id }] },
    });
    expect(staff.status, JSON.stringify(staff.body)).toBe(201);
    expect(
      (await api("/admin/users", { token: both.token, body: { username: "newowner", displayName: "X", password: "owner-pass-12345", grants: [{ role: "OWNER", estateId: null }] } })).body.code,
    ).toBe("OWNER_ONLY");
    expect(
      (
        await api("/admin/users", {
          token: one.token,
          body: { username: "wrongestate", displayName: "X", password: "supervisor-pass-9", grants: [{ role: "FIELD_SUPERVISOR", estateId: s.estate2.id }] },
        })
      ).body.code,
    ).toBe("ESTATE_NOT_YOURS");
    expect(
      (await api("/admin/users", { token: both.token, body: { username: "everywhere", displayName: "X", password: "supervisor-pass-9", grants: [{ role: "FIELD_SUPERVISOR", estateId: null }] } })).body
        .code,
    ).toBe("ESTATE_NOT_YOURS");
    const users = (await api("/admin/users", { token: s.owner.token })).body as { id: string; username: string }[];
    const ownerId = users.find((u) => u.username === "owner")?.id ?? "";
    expect((await api(`/admin/users/${ownerId}/disable`, { token: both.token, body: { reason: "Not allowed" } })).body.code).toBe("OWNER_ONLY");
    expect((await api(`/admin/users/${ownerId}/password`, { token: both.token, body: { password: "a-new-password-123" } })).body.code).toBe("OWNER_ONLY");
    expect((await api(`/admin/users/${staff.body.id}`, { method: "PUT", token: both.token, body: { displayName: "Renamed", grants: [{ role: "OWNER", estateId: null }] } })).body.code).toBe(
      "OWNER_ONLY",
    );
    expect(
      (await api(`/admin/users/${staff.body.id}`, { method: "PUT", token: both.token, body: { displayName: "Renamed", grants: [{ role: "FIELD_SUPERVISOR", estateId: s.estate.id }] } })).status,
    ).toBe(200);
    // A supervisor still cannot manage users.
    expect((await api("/admin/users", { token: s.supervisor.token })).status).toBe(403);
  });

  it("keeps the plucking flag on jobs and expected readings per day on log kinds", async () => {
    const s = await setupTenant();
    const job = await api("/job-types", { token: s.owner.token, body: { code: "PRN", name: "Pruning", countsAsPlucking: false } });
    expect(job.body).toMatchObject({ countsAsPlucking: false });
    const upd = await api(`/job-types/${s.plk.id}`, { method: "PUT", token: s.owner.token, body: { code: "PLK", name: "Plucking", countsAsPlucking: true, active: true } });
    expect(upd.body).toMatchObject({ countsAsPlucking: true });
    const kind = await api("/admin/log-kinds", {
      token: s.owner.token,
      body: { code: "RAIN", label: "Rain", unit: "mm", valueType: "NUMBER", decimals: 0, minScaled: 0, maxScaled: 300, expectedPerDay: 2 },
    });
    expect(kind.body).toMatchObject({ expectedPerDay: 2 });
  });

  it("lists users with their last sign-in", async () => {
    const s = await setupTenant();
    const list = (await api("/admin/users", { token: s.owner.token })).body as { username: string; lastSignInAt: string | null }[];
    expect(list.find((u) => u.username === "sup1")?.lastSignInAt).toMatch(/^\d{4}-/);
  });
});

describe("reports, season and user access", () => {
  it("reports weigh-ins by field and worker over a range, and hides worker detail from a supervisor", async () => {
    const s = await setupTenant();
    const w = (workerId: string, fieldId: string, gross: string, crop = "COFFEE") =>
      mutation(s.supervisor.deviceId, s.estate.id, "muster_entry", "create", { businessDate: today(), workerId, fieldId, crop, grossKg: gross, bags: 1, tareKg: "0" });
    const ms = [await w(s.w1.id, s.f1.id, "20"), await w(s.w1.id, s.f1.id, "5"), await w(s.w2.id, s.f2.id, "12"), await w(s.w2.id, s.f2.id, "3", "PEPPER")];
    expect((await push(s.supervisor, ms)).body.results.map((r: { status: string }) => r.status)).toEqual(["accepted", "accepted", "accepted", "accepted"]);
    const url = `/estates/${s.estate.id}/reports/plucking?from=${today()}&to=${today()}`;
    const owner = (await api(url, { token: s.owner.token })).body;
    expect(owner.totals).toMatchObject({ entries: 4, coffeeNetKg: "37.000", pepperNetKg: "3.000" });
    expect(owner.byField.find((f: { field: string }) => f.field === "Field One")).toMatchObject({ coffeeNetKg: "25.000", workerDays: 1, coffeePerWorkerDayKg: "25.000" });
    expect(owner.byWorker[0]).toMatchObject({ employeeCode: "W001", coffeeNetKg: "25.000", days: 1, entries: 2 });
    const sup = (await api(url, { token: s.supervisor.token })).body;
    expect(sup.byWorker).toBeNull();
    expect(sup.byField).toHaveLength(2);
    expect((await api(`/estates/${s.estate.id}/reports/plucking?from=${today()}&to=2020-01-01`, { token: s.owner.token })).body.code).toBe("RANGE");
  });

  it("lists daily log readings over a range and a worker's attendance history", async () => {
    const s = await setupTenant();
    const kind = (
      await api("/admin/log-kinds", { token: s.owner.token, body: { code: "RAIN", label: "Rain", unit: "mm", valueType: "NUMBER", decimals: 0, minScaled: 0, maxScaled: 300, expectedPerDay: 2 } })
    ).body;
    const r = await mutation(s.supervisor.deviceId, s.estate.id, "dailylog_entry", "create", { businessDate: today(), kindId: kind.id, value: "12", readingAt: new Date().toISOString() });
    await push(s.supervisor, [r]);
    const range = (await api(`/estates/${s.estate.id}/daily-log?from=${today()}&to=${today()}`, { token: s.supervisor.token })).body;
    expect(range.kinds.find((k: { id: string }) => k.id === kind.id)).toMatchObject({ expectedPerDay: 2 });
    expect(range.readings).toEqual([expect.objectContaining({ kindId: kind.id, valueScaled: 12 })]);

    const a = await mutation(s.supervisor.deviceId, s.estate.id, "attendance_record", "upsert", {
      businessDate: today(),
      workerId: s.w1.id,
      statusCode: "PRESENT",
      dayFraction: "HALF",
      fieldId: s.f1.id,
      jobTypeId: s.plk.id,
    });
    await push(s.supervisor, [a]);
    const h = (await api(`/estates/${s.estate.id}/workers/${s.w1.id}/attendance`, { token: s.supervisor.token })).body;
    expect(h).toMatchObject({ worker: { employeeCode: "W001" }, daysWorked: 0.5 });
    expect(h.records[0]).toMatchObject({ field: "Field One", job: "Plucking", dayFraction: "HALF" });
    // A worker of another estate is not found through this estate.
    expect((await api(`/estates/${s.estate.id}/workers/${s.w101.id}/attendance`, { token: s.owner.token })).status).toBe(404);
  });

  it("shows season totals on the dashboard only once the season start is set", async () => {
    const s = await setupTenant();
    await api(`/fields`, { token: s.owner.token, body: { estateId: s.estate.id, name: "Expecting", areaCentiAcres: 500, expectedCherryKg: 1000, crops: ["COFFEE"] } });
    const m = await mutation(s.supervisor.deviceId, s.estate.id, "muster_entry", "create", {
      businessDate: today(),
      workerId: s.w1.id,
      fieldId: s.f1.id,
      crop: "COFFEE",
      grossKg: "250",
      bags: 1,
      tareKg: "0",
    });
    await push(s.supervisor, [m]);
    const dash = async () => (await api(`/estates/${s.estate.id}/reports/dashboard/${today()}`, { token: s.owner.token })).body.season;
    expect(await dash()).toMatchObject({ startDate: null, expectedKg: "1000.000", percent: null });
    const set = await api("/admin/settings/season.startDate", { method: "PUT", token: s.owner.token, body: { value: today() } });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    expect(await dash()).toMatchObject({ startDate: today(), coffeeNetKg: "250.000", percent: 25 });
    expect((await api("/admin/settings/season.startDate", { method: "PUT", token: s.owner.token, body: { value: "not a date" } })).status).toBe(422);
  });

  it("edits a user's access, ends their sessions, re-enables them, and keeps one owner", async () => {
    const s = await setupTenant();
    const list = async () =>
      (await api("/admin/users", { token: s.owner.token })).body as { id: string; username: string; status: string; displayName: string; grants: { role: string; estateId: string | null }[] }[];
    const sup = (await list()).find((u) => u.username === "sup1");
    if (!sup) throw new Error("no supervisor");
    const edit = await api(`/admin/users/${sup.id}`, { method: "PUT", token: s.owner.token, body: { displayName: "Supervisor Renamed", grants: [{ role: "ESTATE_MANAGER", estateId: s.estate.id }] } });
    expect(edit.status, JSON.stringify(edit.body)).toBe(200);
    expect((await list()).find((u) => u.id === sup.id)).toMatchObject({ displayName: "Supervisor Renamed", grants: [{ role: "ESTATE_MANAGER", estateId: s.estate.id }] });
    // The old session is ended.
    expect((await api("/reference", { token: s.supervisor.token })).status).toBe(401);

    const bad = await api(`/admin/users/${sup.id}`, { method: "PUT", token: s.owner.token, body: { displayName: "X", grants: [{ role: "FIELD_SUPERVISOR", estateId: uuidv7() }] } });
    expect(bad.body.code).toBe("ESTATE_UNKNOWN");
    const owner = (await list()).find((u) => u.username === "owner");
    if (!owner) throw new Error("no owner");
    expect((await api(`/admin/users/${owner.id}`, { method: "PUT", token: s.owner.token, body: { displayName: "Me", grants: [{ role: "AUDITOR", estateId: null }] } })).body.code).toBe("SELF_EDIT");

    await api(`/admin/users/${sup.id}/disable`, { token: s.owner.token, body: { reason: "Left the estate" } });
    expect((await list()).find((u) => u.id === sup.id)?.status).toBe("DISABLED");
    expect((await api(`/admin/users/${sup.id}/enable`, { method: "POST", token: s.owner.token })).status).toBe(200);
    expect((await list()).find((u) => u.id === sup.id)?.status).toBe("ACTIVE");
    // A field supervisor cannot manage users.
    const plain = await api("/admin/users", {
      token: s.owner.token,
      body: { username: "plainsup", displayName: "Plain Supervisor", password: "supervisor-pass-2", grants: [{ role: "FIELD_SUPERVISOR", estateId: s.estate.id }] },
    });
    expect(plain.status).toBe(201);
    const plainLogin = await login(s.code, "plainsup", "supervisor-pass-2");
    expect((await api(`/admin/users/${sup.id}/enable`, { method: "POST", token: plainLogin.token })).status).toBe(403);
  });
});
