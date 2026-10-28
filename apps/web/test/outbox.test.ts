import { canonicalJson, sha256Hex } from "@cemms/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setAccess } from "../src/lib/api";
import { db } from "../src/lib/db";
import { counts, dismissRejected, queueChange } from "../src/lib/outbox";
import { syncNow } from "../src/lib/sync";

const base = { tenantId: "t1", userId: "u1", deviceId: "01a18000-0000-7000-8000-000000000001", estateId: "e1", businessDate: "2026-11-01" };

beforeEach(async () => {
  await db.delete();
  await db.open();
  setAccess({
    accessToken: "tok",
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
    sessionExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    user: { id: "u1", username: "s", displayName: "S", tenantId: "t1", tenantName: "T", grants: [], mustChangePassword: false },
  });
});

describe("outbox", () => {
  it("writes the record and the mutation together, with a correct hash and chained versions", async () => {
    const a = await queueChange({ ...base, entityType: "attendance_record", op: "upsert", payload: { businessDate: base.businessDate, workerId: "w1", statusCode: "ABSENT" }, label: "a" });
    await queueChange({
      ...base,
      entityType: "attendance_record",
      op: "upsert",
      entityId: a.entityId,
      payload: { businessDate: base.businessDate, workerId: "w1", statusCode: "PRESENT" },
      label: "b",
    });
    const items = await db.outbox.orderBy("createdAt").toArray();
    expect(items.map((i) => i.envelope.baseVersion)).toEqual([0, 1]);
    expect(items[0]?.envelope.payloadHash).toBe(await sha256Hex(canonicalJson(items[0]?.envelope.payload)));
    const rec = await db.records.get(`attendance_record:${a.entityId}`);
    expect(rec).toMatchObject({ status: "waiting", nextBase: 2, serverVersion: 0, lastMutationId: items[1]?.mutationId });
    expect(await counts("u1")).toMatchObject({ waiting: 2 });
  });

  it("applies per-item results: accepted, rejected and retryable", async () => {
    const ok = await queueChange({ ...base, entityType: "muster_entry", op: "create", payload: { x: 1 }, label: "ok" });
    const bad = await queueChange({ ...base, entityType: "muster_entry", op: "create", payload: { x: 2 }, label: "bad" });
    const later = await queueChange({ ...base, entityType: "muster_entry", op: "create", payload: { x: 3 }, label: "later" });
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      expect(body.pendingCount).toBe(0);
      return new Response(
        JSON.stringify({
          results: [
            { mutationId: ok.mutationId, status: "accepted", entityId: ok.entityId, version: 1, serverTime: "" },
            { mutationId: bad.mutationId, status: "rejected", entityId: bad.entityId, version: null, serverTime: "", errorCode: "NET_NEGATIVE", message: "Tare cannot be more than the gross weight" },
            { mutationId: later.mutationId, status: "rejected", entityId: later.entityId, version: null, serverTime: "", errorCode: "SERVER_ERROR", retryable: true },
          ],
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const report = await syncNow("u1", base.deviceId);
    expect(report).toMatchObject({ sent: 3, accepted: 1, rejected: 1 });
    expect((await db.outbox.get(ok.mutationId))?.status).toBe("accepted");
    expect((await db.records.get(`muster_entry:${ok.entityId}`))?.status).toBe("accepted");
    expect((await db.outbox.get(bad.mutationId))?.status).toBe("rejected");
    expect((await db.records.get(`muster_entry:${bad.entityId}`))?.message).toMatch(/Tare/);
    const retry = await db.outbox.get(later.mutationId);
    expect(retry).toMatchObject({ status: "waiting", attempts: 1 });
    expect(retry?.nextAttemptAt).toBeGreaterThan(0);
    await dismissRejected(bad.mutationId);
    expect(await db.outbox.get(bad.mutationId)).toBeUndefined();
    vi.unstubAllGlobals();
  });

  it("keeps everything when the network fails and only sends the signed-in user's entries", async () => {
    await queueChange({ ...base, entityType: "muster_entry", op: "create", payload: { x: 1 }, label: "mine" });
    await queueChange({ ...base, userId: "u2", entityType: "muster_entry", op: "create", payload: { x: 2 }, label: "theirs" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("network down");
      }),
    );
    const report = await syncNow("u1", base.deviceId);
    expect(report.error).toBeTruthy();
    expect(await db.outbox.count()).toBe(2);
    expect(await counts("u1")).toMatchObject({ waiting: 1, otherUsersWaiting: 1 });
    vi.unstubAllGlobals();
  });
});
