import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { api, mutation, push, setupTenant, today } from "./helpers";

/** Fetch a file; the helper in helpers.ts reads bodies as text, which would damage a binary file. */
async function file(path: string, token: string) {
  const res = await exports.default.fetch(
    new Request(`http://localhost/api/v1${path}`, { headers: { authorization: `Bearer ${token}`, "cf-connecting-ip": `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` } }),
  );
  const bytes = new Uint8Array(await res.arrayBuffer());
  return { status: res.status, headers: res.headers, bytes, text: new TextDecoder().decode(bytes) };
}

describe("excel exports", () => {
  it("builds the old-format sheet per date and the new-format tables, for people who may see worker detail", async () => {
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
      workerId: s.w2.id,
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
    expect((await push(s.supervisor, [mark, night, weigh])).body.results.map((r: { status: string }) => r.status)).toEqual(["accepted", "accepted", "accepted"]);

    const old = await file(`/estates/${s.estate.id}/reports/export?format=old&from=${d}&to=${d}`, s.owner.token);
    expect(old.status).toBe(200);
    expect(old.headers.get("content-type")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(old.headers.get("content-disposition")).toMatch(/GLZ-.*-old-format\.xlsx/);
    expect([old.bytes[0], old.bytes[1]]).toEqual([0x50, 0x4b]);
    const [dd, mm, yyyy] = [d.slice(8), d.slice(5, 7), d.slice(0, 4)];
    expect(old.text).toContain(`name="${dd}-${mm}-${yyyy}"`);
    expect(old.text).toContain("OLD FORMAT");
    expect(old.text).toContain("Worker A");
    expect(old.text).toContain("Night shift");
    expect(old.text).toContain("Gross(Kgs)");
    // Workers of the other estate are not in this file.
    expect(old.text).not.toContain("Worker D");

    const fresh = await file(`/estates/${s.estate.id}/reports/export?format=new&from=${d}&to=${d}`, s.owner.token);
    expect(fresh.status).toBe(200);
    expect(fresh.headers.get("content-disposition")).toMatch(/new-format\.xlsx/);
    for (const sheet of ["About", "Summary by day", "Attendance", "Plucking"]) expect(fresh.text).toContain(`name="${sheet}"`);

    // A supervisor has no worker-detail permission, and another estate's data is out of reach.
    expect((await file(`/estates/${s.estate.id}/reports/export?format=old&from=${d}&to=${d}`, s.supervisor.token)).status).toBe(403);
    expect((await file(`/estates/${s.estate2.id}/reports/export?format=new&from=${d}&to=${d}`, s.supervisor.token)).status).toBe(403);

    // Limits and empty ranges.
    expect((await file(`/estates/${s.estate.id}/reports/export?format=old&from=2026-01-01&to=2026-06-01`, s.owner.token)).status).toBe(422);
    expect((await file(`/estates/${s.estate.id}/reports/export?format=old&from=${d}&to=2020-01-01`, s.owner.token)).status).toBe(422);
    expect((await file(`/estates/${s.estate.id}/reports/export?format=old&from=2020-01-01&to=2020-01-03`, s.owner.token)).status).toBe(404);
    expect((await file(`/estates/${s.estate.id}/reports/export?format=new&from=2020-01-01&to=2020-01-03`, s.owner.token)).status).toBe(200);
    expect((await file(`/estates/${s.estate.id}/reports/export?format=old&from=bad&to=${d}`, s.owner.token)).status).toBeGreaterThanOrEqual(400);

    // Worker-level figures left the system, so it is on the audit trail.
    const audit = (await api(`/audit?estateId=${s.estate.id}&entityType=report`, { token: s.owner.token })).body;
    expect(JSON.stringify(audit)).toContain("report.export");
  });
});
