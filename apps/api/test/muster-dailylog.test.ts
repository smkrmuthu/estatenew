import { describe, expect, it } from "vitest";
import { api, mutation, push, setupTenant, today } from "./helpers";

const weigh = (s: Awaited<ReturnType<typeof setupTenant>>, extra: Record<string, unknown> = {}) => ({
  businessDate: today(),
  workerId: s.w1.id,
  fieldId: s.f1.id,
  crop: "COFFEE",
  grossKg: "20.500",
  bags: 2,
  tareKg: "1",
  ...extra,
});

describe("weigh-in (muster)", () => {
  it("records coffee and pepper with the same capture and recomputes net on the server", async () => {
    const s = await setupTenant();
    const coffee = await mutation(s.supervisor.deviceId, s.estate.id, "muster_entry", "create", weigh(s, { varietyId: s.cg.id }));
    const pepper = await mutation(
      s.supervisor.deviceId,
      s.estate.id,
      "muster_entry",
      "create",
      weigh(s, { fieldId: s.f2.id, crop: "PEPPER", grossKg: "3.25", bags: 1, tareKg: null, varietyId: s.pnl.id }),
    );
    const again = await mutation(s.supervisor.deviceId, s.estate.id, "muster_entry", "create", weigh(s, { grossKg: "5", tareKg: "0" }));
    const r = (await push(s.supervisor, [coffee, pepper, again])).body.results;
    expect(r.map((x: { status: string }) => x.status)).toEqual(["accepted", "accepted", "accepted"]);
    const list = (await api(`/estates/${s.estate.id}/muster/${today()}`, { token: s.owner.token })).body as { id: string; netG: number; grossG: number; tareG: number; crop: string }[];
    const byId = new Map(list.map((e) => [e.id, e]));
    expect(byId.get(coffee.entityId)).toMatchObject({ grossG: 20500, tareG: 1000, netG: 19500, crop: "COFFEE" });
    expect(byId.get(pepper.entityId)).toMatchObject({ grossG: 3250, tareG: 0, netG: 3250, crop: "PEPPER" });

    const summary = (await api(`/estates/${s.estate.id}/reports/daily/${today()}`, { token: s.supervisor.token })).body;
    expect(summary.basis).toBe("server-accepted");
    expect(summary.weighIn.byCrop).toEqual(
      expect.arrayContaining([
        { crop: "COFFEE", entries: 2, workers: 1, netKg: "24.500" },
        { crop: "PEPPER", entries: 1, workers: 1, netKg: "3.250" },
      ]),
    );
    expect(summary.weighIn.workersWithSeveralEntries).toBe(1);
  });

  it("refuses bad weights, crops not grown in the field and varieties of another crop", async () => {
    const s = await setupTenant();
    const cases = [weigh(s, { grossKg: "1", tareKg: "2" }), weigh(s, { grossKg: "12.3456" }), weigh(s, { crop: "PEPPER" }), weigh(s, { varietyId: s.pnl.id }), weigh(s, { grossKg: "600" })];
    const ms = await Promise.all(cases.map((p) => mutation(s.supervisor.deviceId, s.estate.id, "muster_entry", "create", p)));
    const r = (await push(s.supervisor, ms)).body.results;
    expect(r.map((x: { errorCode: string }) => x.errorCode)).toEqual(["NET_NEGATIVE", "VALIDATION", "CROP_NOT_ON_FIELD", "VARIETY_UNKNOWN", "WEIGHT_TOO_LARGE"]);
  });

  it("a supervisor cancels their own entry with a reason; managers correct with a reason", async () => {
    const s = await setupTenant();
    const m = await mutation(s.supervisor.deviceId, s.estate.id, "muster_entry", "create", weigh(s));
    await push(s.supervisor, [m]);
    const noReason = await mutation(s.supervisor.deviceId, s.estate.id, "muster_entry", "void", { reason: "" }, { entityId: m.entityId, baseVersion: 1 });
    expect((await push(s.supervisor, [noReason])).body.results[0].errorCode).toBe("VALIDATION");
    const v = await mutation(s.supervisor.deviceId, s.estate.id, "muster_entry", "void", { reason: "Weighed twice" }, { entityId: m.entityId, baseVersion: 1 });
    expect((await push(s.supervisor, [v])).body.results[0]).toMatchObject({ status: "accepted", version: 2 });

    const m2 = await mutation(s.supervisor.deviceId, s.estate.id, "muster_entry", "create", weigh(s, { workerId: s.w2.id }));
    await push(s.supervisor, [m2]);
    expect((await api(`/muster-entries/${m2.entityId}/corrections`, { token: s.supervisor.token, body: { ...weigh(s), reason: "x wrong", baseVersion: 1 } })).status).toBe(403);
    const fix = await api(`/muster-entries/${m2.entityId}/corrections`, {
      token: s.owner.token,
      body: { fieldId: s.f1.id, crop: "COFFEE", grossKg: "21", bags: 2, tareKg: "1", reason: "Scale misread", baseVersion: 1 },
    });
    expect(fix.body).toMatchObject({ netG: 20000, version: 2 });
    const summary = (await api(`/estates/${s.estate.id}/reports/daily/${today()}`, { token: s.owner.token })).body;
    expect(summary.weighIn.byCrop).toEqual([{ crop: "COFFEE", entries: 1, workers: 1, netKg: "20.000" }]);
  });
});

describe("daily log", () => {
  it("uses configured kinds only and validates readings", async () => {
    const s = await setupTenant();
    const none = await mutation(s.supervisor.deviceId, s.estate.id, "dailylog_entry", "create", { businessDate: today(), kindId: s.w1.id, readingAt: new Date().toISOString(), value: "24" });
    expect((await push(s.supervisor, [none])).body.results[0].errorCode).toBe("LOG_KIND_UNKNOWN");
    expect(
      (await api("/admin/log-kinds", { token: s.supervisor.token, body: { code: "TEMP", label: "Temperature", unit: "°C", valueType: "NUMBER", decimals: 1, minScaled: -100, maxScaled: 600 } }))
        .status,
    ).toBe(403);
    const kind = (await api("/admin/log-kinds", { token: s.owner.token, body: { code: "TEMP", label: "Temperature", unit: "°C", valueType: "NUMBER", decimals: 1, minScaled: -100, maxScaled: 600 } }))
      .body;
    const ok = await mutation(s.supervisor.deviceId, s.estate.id, "dailylog_entry", "create", { businessDate: today(), kindId: kind.id, readingAt: new Date().toISOString(), value: "24.5" });
    const range = await mutation(s.supervisor.deviceId, s.estate.id, "dailylog_entry", "create", { businessDate: today(), kindId: kind.id, readingAt: new Date().toISOString(), value: "99" });
    const r = (await push(s.supervisor, [ok, range])).body.results;
    expect(r.map((x: { status: string; errorCode?: string }) => x.errorCode ?? x.status)).toEqual(["accepted", "READING_RANGE"]);
    const summary = (await api(`/estates/${s.estate.id}/reports/daily/${today()}`, { token: s.owner.token })).body;
    expect(summary.dailyLog).toEqual([expect.objectContaining({ kind: "Temperature", unit: "°C", value: "24.5" })]);
    const fix = await api(`/daily-log-entries/${ok.entityId}/corrections`, { token: s.owner.token, body: { value: "25.0", reason: "Read wrong thermometer", baseVersion: 1 } });
    expect(fix.body).toMatchObject({ valueScaled: 250, version: 2 });
  });
});
