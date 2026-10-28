import { describe, expect, it } from "vitest";
import { api, mutation, push, setupTenant, today } from "./helpers";

describe("sync contract", () => {
  it("returns per-item results for a mixed batch and the same answer on retry", async () => {
    const s = await setupTenant();
    const good = await mutation(s.supervisor.deviceId, s.estate.id, "attendance_record", "upsert", { businessDate: today(), workerId: s.w1.id, statusCode: "ABSENT" });
    const bad = await mutation(s.supervisor.deviceId, s.estate.id, "attendance_record", "upsert", { businessDate: "2026-02-30", workerId: s.w2.id, statusCode: "ABSENT" });
    const tampered = {
      ...(await mutation(s.supervisor.deviceId, s.estate.id, "attendance_record", "upsert", { businessDate: today(), workerId: s.w3.id, statusCode: "ABSENT" })),
      payloadHash: "0".repeat(64),
    };
    const unsupported = await mutation(s.supervisor.deviceId, s.estate.id, "muster_entry", "upsert", {});
    const first = (await push(s.supervisor, [good, bad, tampered, unsupported], 7)).body.results;
    expect(first.map((r: { status: string }) => r.status)).toEqual(["accepted", "rejected", "rejected", "rejected"]);
    expect(first[1].fieldErrors.businessDate).toBeTruthy();
    expect(first[2]).toMatchObject({ errorCode: "HASH_MISMATCH", retryable: true });
    expect(first[3].errorCode).toBe("UNSUPPORTED");

    // Lost acknowledgement: the phone sends the same batch again.
    const second = (await push(s.supervisor, [good, bad])).body.results;
    expect(second[0]).toMatchObject({ status: "accepted", duplicate: true, version: 1 });
    expect(second[1]).toMatchObject({ status: "rejected", duplicate: true });
    const sheet = (await api(`/estates/${s.estate.id}/attendance/${today()}`, { token: s.owner.token })).body;
    expect(sheet.records).toHaveLength(1);

    // Reusing a mutation id for other data is refused.
    const reused = {
      ...(await mutation(s.supervisor.deviceId, s.estate.id, "attendance_record", "upsert", { businessDate: today(), workerId: s.w2.id, statusCode: "ABSENT" })),
      mutationId: good.mutationId,
    };
    expect((await push(s.supervisor, [reused])).body.results[0].errorCode).toBe("MUTATION_REUSED");

    // The last push reported nothing waiting on the phone.
    const summary = (await api(`/estates/${s.estate.id}/reports/daily/${today()}`, { token: s.owner.token })).body;
    expect(summary.sync).toMatchObject({ devicesWaiting: 0, entriesWaitingOnDevices: 0 });
  });

  it("binds mutations to the session's device", async () => {
    const s = await setupTenant();
    const m = await mutation(s.owner.deviceId, s.estate.id, "attendance_record", "upsert", { businessDate: today(), workerId: s.w1.id, statusCode: "ABSENT" });
    expect((await api("/sync/push", { token: s.supervisor.token, body: { deviceId: s.owner.deviceId, pendingCount: 0, mutations: [m] } })).body.code).toBe("DEVICE_MISMATCH");
    expect((await push(s.supervisor, [m])).body.results[0].errorCode).toBe("DEVICE_MISMATCH");
  });

  it("limits batch size and validates the envelope", async () => {
    const s = await setupTenant();
    const many = await Promise.all(Array.from({ length: 101 }, () => mutation(s.supervisor.deviceId, s.estate.id, "attendance_record", "upsert", {})));
    expect((await push(s.supervisor, many)).status).toBe(422);
    expect((await push(s.supervisor, [{ nope: true }])).status).toBe(422);
  });

  it("keeps a reported pending count for the summary", async () => {
    const s = await setupTenant();
    const m = await mutation(s.supervisor.deviceId, s.estate.id, "attendance_record", "upsert", { businessDate: today(), workerId: s.w1.id, statusCode: "ABSENT" });
    await push(s.supervisor, [m], 12);
    const summary = (await api(`/estates/${s.estate.id}/reports/daily/${today()}`, { token: s.owner.token })).body;
    expect(summary.sync).toMatchObject({ devicesWaiting: 1, entriesWaitingOnDevices: 12 });
    expect(summary.attendance.marked).toBe(1);
  });
});
