import { describe, expect, it } from "vitest";
import { api, createTenant, login, setupTenant } from "./helpers";

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

  it("rejects formula injection and a gender column", async () => {
    const s = await setupTenant();
    const res = (await api("/imports/preview", { token: s.owner.token, body: { kind: "workers", csv: "estate_code,employee_code,name,gender\nGLZ,W1,=HYPERLINK(1),F\n" } })).body;
    expect(res.errors.map((e: { column: string }) => e.column)).toEqual(["gender"]);
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
