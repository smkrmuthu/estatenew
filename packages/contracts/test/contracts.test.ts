import { uuidv7 } from "@cemms/domain";
import { describe, expect, it } from "vitest";
import { loginRequest, MUTATION_PAYLOADS, musterEntryPayload, syncPush, userCreate } from "../src";

describe("contracts", () => {
  it("normalises sign-in input and rejects a malformed device id", () => {
    expect(loginRequest.parse({ tenant: " Demo ", username: "Sup1", password: "x", deviceId: uuidv7() })).toMatchObject({ tenant: "demo", username: "sup1" });
    expect(loginRequest.safeParse({ tenant: "demo", username: "s1", password: "x", deviceId: "not-a-uuid" }).success).toBe(false);
  });
  it("accepts kilograms as decimal strings only", () => {
    const base = { businessDate: "2026-11-01", workerId: uuidv7(), fieldId: uuidv7(), crop: "PEPPER", bags: 1 };
    expect(musterEntryPayload.safeParse({ ...base, grossKg: "12.5" }).success).toBe(true);
    expect(musterEntryPayload.safeParse({ ...base, grossKg: 12.5 }).success).toBe(false);
    expect(musterEntryPayload.safeParse({ ...base, grossKg: "1.2345" }).success).toBe(false);
    expect(musterEntryPayload.safeParse({ ...base, crop: "TEA", grossKg: "1" }).success).toBe(false);
  });
  it("caps sync batches and knows every supported change", () => {
    const m = {
      mutationId: uuidv7(),
      entityType: "attendance_record",
      entityId: uuidv7(),
      op: "upsert",
      estateId: uuidv7(),
      deviceId: uuidv7(),
      schemaVersion: 1,
      capturedAt: new Date().toISOString(),
      baseVersion: 0,
      payload: {},
      payloadHash: "a".repeat(64),
    };
    expect(syncPush.safeParse({ deviceId: uuidv7(), pendingCount: 0, mutations: Array.from({ length: 100 }, () => m) }).success).toBe(true);
    expect(syncPush.safeParse({ deviceId: uuidv7(), pendingCount: 0, mutations: Array.from({ length: 101 }, () => m) }).success).toBe(false);
    expect(Object.keys(MUTATION_PAYLOADS).sort()).toEqual([
      "attendance_record:upsert",
      "attendance_record:void",
      "attendance_sheet:submit",
      "dailylog_entry:create",
      "dailylog_entry:void",
      "muster_entry:create",
      "muster_entry:void",
    ]);
  });
  it("requires strong first passwords for new users", () => {
    expect(userCreate.safeParse({ username: "sup2", displayName: "S", password: "short", grants: [{ role: "FIELD_SUPERVISOR", estateId: uuidv7() }] }).success).toBe(false);
  });
});
