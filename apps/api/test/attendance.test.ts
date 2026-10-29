import { uuidv7 } from "@cemms/domain";
import { describe, expect, it } from "vitest";
import { api, login, mutation, push, setupTenant, today } from "./helpers";

const present = (s: Awaited<ReturnType<typeof setupTenant>>, workerId: string, extra: Record<string, unknown> = {}) => ({
  businessDate: today(),
  workerId,
  statusCode: "PRESENT",
  dayFraction: "FULL",
  fieldId: s.f1.id,
  jobTypeId: s.plk.id,
  ...extra,
});

describe("attendance shifts", () => {
  it("keeps a Day row and a Night row for the same worker, each with its own register and submit", async () => {
    const s = await setupTenant();
    const d = today();
    const night = { businessDate: d, shift: "NIGHT", workerId: s.w1.id, statusCode: "PRESENT", dayFraction: "FULL", fieldId: s.f1.id, jobTypeId: s.plk.id };
    const day = await mutation(s.supervisor.deviceId, s.estate.id, "attendance_record", "upsert", present(s, s.w1.id));
    const nt = await mutation(s.supervisor.deviceId, s.estate.id, "attendance_record", "upsert", night);
    const res = await push(s.supervisor, [day, nt]);
    expect(res.body.results.map((r: { status: string }) => r.status)).toEqual(["accepted", "accepted"]);

    const dayRegister = (await api(`/estates/${s.estate.id}/attendance/${d}`, { token: s.supervisor.token })).body;
    const nightRegister = (await api(`/estates/${s.estate.id}/attendance/${d}?shift=NIGHT`, { token: s.supervisor.token })).body;
    expect(dayRegister.records.map((r: { shift: string }) => r.shift)).toEqual(["DAY"]);
    expect(nightRegister.records.map((r: { shift: string }) => r.shift)).toEqual(["NIGHT"]);

    // Submitting the Day register leaves the Night register open.
    const submit = await mutation(s.supervisor.deviceId, s.estate.id, "attendance_sheet", "submit", { businessDate: d });
    expect((await push(s.supervisor, [submit])).body.results[0].status).toBe("accepted");
    const nightChange = await mutation(s.supervisor.deviceId, s.estate.id, "attendance_record", "upsert", { ...night, remarks: "Rain" }, { entityId: nt.entityId, baseVersion: 1 });
    expect((await push(s.supervisor, [nightChange])).body.results[0].status).toBe("accepted");
    expect((await api(`/estates/${s.estate.id}/attendance/${d}?shift=NIGHT`, { token: s.supervisor.token })).body.sheet.state).toBe("DRAFT");

    // A second Night row for the same worker is a conflict, not a silent overwrite.
    const again = await mutation(s.supervisor.deviceId, s.estate.id, "attendance_record", "upsert", { ...night, statusCode: "ABSENT", dayFraction: null, fieldId: null, jobTypeId: null });
    expect((await push(s.supervisor, [again])).body.results[0].status).toBe("conflict");

    const bad = await api(`/estates/${s.estate.id}/attendance/${d}?shift=EVENING`, { token: s.supervisor.token });
    expect(bad.status).toBeGreaterThanOrEqual(400);
  });
});

describe("one worker on both shifts in one day", () => {
  it("counts people and shifts separately and shows the double shift on both registers", async () => {
    const s = await setupTenant();
    const d = today();
    const night = { businessDate: d, shift: "NIGHT", workerId: s.w1.id, statusCode: "PRESENT", dayFraction: "FULL", fieldId: s.f1.id, jobTypeId: s.plk.id };
    const day = await mutation(s.supervisor.deviceId, s.estate.id, "attendance_record", "upsert", present(s, s.w1.id));
    const nt = await mutation(s.supervisor.deviceId, s.estate.id, "attendance_record", "upsert", night);
    // A second worker is on Day only.
    const other = await mutation(s.supervisor.deviceId, s.estate.id, "attendance_record", "upsert", present(s, s.w2.id));
    expect((await push(s.supervisor, [day, nt, other])).body.results.map((r: { status: string }) => r.status)).toEqual(["accepted", "accepted", "accepted"]);

    // Each register tells who is already present in the other shift.
    const dayRegister = (await api(`/estates/${s.estate.id}/attendance/${d}`, { token: s.supervisor.token })).body;
    const nightRegister = (await api(`/estates/${s.estate.id}/attendance/${d}?shift=NIGHT`, { token: s.supervisor.token })).body;
    expect(dayRegister.otherShift.shift).toBe("NIGHT");
    expect(dayRegister.otherShift.present.map((r: { workerId: string }) => r.workerId)).toEqual([s.w1.id]);
    expect(nightRegister.otherShift.shift).toBe("DAY");
    expect(nightRegister.otherShift.present.map((r: { workerId: string }) => r.workerId).sort()).toEqual([s.w1.id, s.w2.id].sort());

    // The summary keeps Day and Night apart: Day headcount is Day only, and "both shifts" counts people.
    const summary = (await api(`/estates/${s.estate.id}/reports/daily/${d}`, { token: s.owner.token })).body;
    expect(summary.attendance.present).toBe(2);
    expect(summary.attendance.night.present).toBe(1);
    expect(summary.attendance.night.bothShifts).toBe(1);
    expect(summary.attendance.manDays).toBe("2.0");

    // History: the night is not an extra day, and one date takes one place in the day limit.
    const history = (await api(`/estates/${s.estate.id}/workers/${s.w1.id}/attendance?days=1`, { token: s.owner.token })).body;
    expect(history.daysWorked).toBe(1);
    expect(history.nightShifts).toBe(1);
    expect(history.records.map((r: { shift: string }) => r.shift)).toEqual(["DAY", "NIGHT"]);
  });
});

describe("approval on submit", () => {
  it("a manager's own submit is approved straight away; a supervisor's still waits for a manager", async () => {
    const s = await setupTenant();
    const d = today();
    const mgr = await api("/admin/users", {
      token: s.owner.token,
      body: { username: "mgr1", displayName: "Manager One", password: "manager-pass-1234", grants: [{ role: "ESTATE_MANAGER", estateId: s.estate.id }] },
    });
    expect(mgr.status, JSON.stringify(mgr.body)).toBe(201);
    const manager = await login(s.code, "mgr1", "manager-pass-1234");

    // Supervisor: Day register stays Submitted.
    const sr = await mutation(s.supervisor.deviceId, s.estate.id, "attendance_record", "upsert", present(s, s.w1.id));
    const ss = await mutation(s.supervisor.deviceId, s.estate.id, "attendance_sheet", "submit", { businessDate: d });
    expect((await push(s.supervisor, [sr, ss])).body.results.map((r: { status: string }) => r.status)).toEqual(["accepted", "accepted"]);
    const supSheet = (await api(`/estates/${s.estate.id}/attendance/${d}`, { token: manager.token })).body.sheet;
    expect(supSheet.state).toBe("SUBMITTED");

    // Manager: the Night register is approved by the same submit, with who and when recorded.
    const mr = await mutation(manager.deviceId, s.estate.id, "attendance_record", "upsert", present(s, s.w2.id, { shift: "NIGHT" }));
    const ms = await mutation(manager.deviceId, s.estate.id, "attendance_sheet", "submit", { businessDate: d, shift: "NIGHT" });
    expect((await push(manager, [mr, ms])).body.results.map((r: { status: string }) => r.status)).toEqual(["accepted", "accepted"]);
    const night = (await api(`/estates/${s.estate.id}/attendance/${d}?shift=NIGHT`, { token: manager.token })).body.sheet;
    expect(night).toMatchObject({ state: "APPROVED", submittedBy: manager.user.id, approvedBy: manager.user.id });
    expect(night.approvedAt).toBeTruthy();

    // Both steps are in the audit trail.
    const audit = (await api(`/audit?estateId=${s.estate.id}`, { token: s.owner.token })).body as { action: string; entityId: string }[];
    const forNight = audit.filter((x) => x.entityId === night.id).map((x) => x.action);
    expect(forNight).toEqual(expect.arrayContaining(["attendance.sheet.submit", "attendance.sheet.approve"]));
    // A supervisor's day still needs a manager.
    expect((await api(`/estates/${s.estate.id}/attendance/${d}/actions`, { token: manager.token, body: { action: "approve" } })).body.state).toBe("APPROVED");
  });
});

describe("attendance", () => {
  it("captures offline records, submits, approves and corrects with a reason and full history", async () => {
    const s = await setupTenant();
    const d = today();
    const r1 = await mutation(s.supervisor.deviceId, s.estate.id, "attendance_record", "upsert", present(s, s.w1.id));
    const r2 = await mutation(s.supervisor.deviceId, s.estate.id, "attendance_record", "upsert", present(s, s.w2.id, { dayFraction: "HALF" }));
    const r3 = await mutation(s.supervisor.deviceId, s.estate.id, "attendance_record", "upsert", { businessDate: d, workerId: s.w3.id, statusCode: "ABSENT" });
    const res = await push(s.supervisor, [r1, r2, r3]);
    expect(res.status).toBe(200);
    expect(res.body.results.map((r: { status: string }) => r.status)).toEqual(["accepted", "accepted", "accepted"]);

    // Edit on the same device: based on the version it last saw.
    const edit = await mutation(s.supervisor.deviceId, s.estate.id, "attendance_record", "upsert", present(s, s.w1.id, { remarks: "Came late" }), { entityId: r1.entityId, baseVersion: 1 });
    expect((await push(s.supervisor, [edit])).body.results[0]).toMatchObject({ status: "accepted", version: 2 });

    const sheet = (await api(`/estates/${s.estate.id}/attendance/${d}`, { token: s.supervisor.token })).body;
    expect(sheet.records).toHaveLength(3);
    expect(sheet.statuses.filter((x: { active: boolean }) => x.active).map((x: { code: string }) => x.code)).toEqual(["PRESENT", "ABSENT"]);

    const submit = await mutation(s.supervisor.deviceId, s.estate.id, "attendance_sheet", "submit", { businessDate: d });
    expect((await push(s.supervisor, [submit])).body.results[0].status).toBe("accepted");

    // After submission the phone can no longer change the day.
    const late = await mutation(s.supervisor.deviceId, s.estate.id, "attendance_record", "upsert", present(s, s.w3.id), { entityId: r3.entityId, baseVersion: 1 });
    expect((await push(s.supervisor, [late])).body.results[0]).toMatchObject({ status: "rejected", errorCode: "SHEET_LOCKED" });

    // A manager (owner here) approves, then corrects with a reason.
    expect((await api(`/estates/${s.estate.id}/attendance/${d}/actions`, { token: s.owner.token, body: { action: "return" } })).body.code).toBe("REASON_REQUIRED");
    const approve = await api(`/estates/${s.estate.id}/attendance/${d}/actions`, { token: s.owner.token, body: { action: "approve" } });
    expect(approve.body.state).toBe("APPROVED");
    const noReason = await api(`/attendance-records/${r3.entityId}/corrections`, {
      token: s.owner.token,
      body: { statusCode: "PRESENT", dayFraction: "FULL", fieldId: s.f1.id, jobTypeId: s.plk.id, baseVersion: 1 },
    });
    expect(noReason.status).toBe(422);
    const stale = await api(`/attendance-records/${r3.entityId}/corrections`, {
      token: s.owner.token,
      body: { statusCode: "PRESENT", dayFraction: "FULL", fieldId: s.f1.id, jobTypeId: s.plk.id, reason: "Was present", baseVersion: 7 },
    });
    expect(stale.body.code).toBe("STALE_VERSION");
    const fix = await api(`/attendance-records/${r3.entityId}/corrections`, {
      token: s.owner.token,
      body: { statusCode: "PRESENT", dayFraction: "FULL", fieldId: s.f1.id, jobTypeId: s.plk.id, reason: "Was present, marked by mistake", baseVersion: 1 },
    });
    expect(fix.status).toBe(200);
    expect(fix.body).toMatchObject({ presence: "PRESENT", version: 2 });

    const history = (await api(`/audit/history?entityType=attendance_record&entityId=${r3.entityId}&estateId=${s.estate.id}`, { token: s.owner.token })).body;
    expect(history.map((h: { change: string }) => h.change)).toEqual(["create", "correct"]);
    expect(history[0].data.presence).toBe("ABSENT");
    expect(history[1].reason).toBe("Was present, marked by mistake");

    const summary = (await api(`/estates/${s.estate.id}/reports/daily/${d}`, { token: s.owner.token })).body;
    expect(summary.attendance).toMatchObject({ sheetState: "APPROVED", present: 3, absent: 0, halfDayCount: 1, manDays: "2.5" });

    // A manager can also remove a mark with a reason; the entry stays in the history and every count follows.
    const noWhy = await api(`/attendance-records/${r2.entityId}/removal`, { token: s.owner.token, body: { baseVersion: 1 } });
    expect(noWhy.status).toBe(422);
    expect((await api(`/attendance-records/${r2.entityId}/removal`, { token: s.supervisor.token, body: { reason: "Not mine to remove", baseVersion: 1 } })).status).toBe(403);
    expect((await api(`/attendance-records/${r2.entityId}/removal`, { token: s.owner.token, body: { reason: "Marked twice", baseVersion: 9 } })).body.code).toBe("STALE_VERSION");
    const removed = await api(`/attendance-records/${r2.entityId}/removal`, { token: s.owner.token, body: { reason: "Marked on the wrong worker", baseVersion: 1 } });
    expect(removed.status).toBe(200);
    const afterSheet = (await api(`/estates/${s.estate.id}/attendance/${d}`, { token: s.owner.token })).body;
    expect(afterSheet.records.map((x: { id: string }) => x.id)).not.toContain(r2.entityId);
    const afterSummary = (await api(`/estates/${s.estate.id}/reports/daily/${d}`, { token: s.owner.token })).body;
    expect(afterSummary.attendance).toMatchObject({ present: 2, halfDayCount: 0, manDays: "2.0" });
    const removedHistory = (await api(`/audit/history?entityType=attendance_record&entityId=${r2.entityId}&estateId=${s.estate.id}`, { token: s.owner.token })).body;
    expect(removedHistory.map((h: { change: string }) => h.change)).toEqual(["create", "remove"]);
    expect(removedHistory[1].reason).toBe("Marked on the wrong worker");
    expect((await api(`/attendance-records/${r2.entityId}/removal`, { token: s.owner.token, body: { reason: "Again please", baseVersion: 1 } })).status).toBe(404);
  });

  it("rejects proposed statuses, missing assignments and inactive references", async () => {
    const s = await setupTenant();
    const leave = await mutation(s.supervisor.deviceId, s.estate.id, "attendance_record", "upsert", { businessDate: today(), workerId: s.w1.id, statusCode: "LEAVE" });
    const noField = await mutation(s.supervisor.deviceId, s.estate.id, "attendance_record", "upsert", present(s, s.w2.id, { fieldId: null }));
    const otherEstateField = await mutation(s.supervisor.deviceId, s.estate.id, "attendance_record", "upsert", present(s, s.w3.id, { fieldId: s.b1.id }));
    const r = (await push(s.supervisor, [leave, noField, otherEstateField])).body.results;
    expect(r.map((x: { errorCode: string }) => x.errorCode)).toEqual(["STATUS_NOT_ALLOWED", "FIELD_REQUIRED", "FIELD_UNKNOWN"]);
  });

  it("two devices marking the same worker and day create a conflict, never a silent winner", async () => {
    const s = await setupTenant();
    const other = await login(s.code, "sup1", "supervisor-pass-1");
    const a = await mutation(s.supervisor.deviceId, s.estate.id, "attendance_record", "upsert", present(s, s.w1.id));
    const b = await mutation(other.deviceId, s.estate.id, "attendance_record", "upsert", present(s, s.w1.id, { dayFraction: "HALF" }));
    expect((await push(s.supervisor, [a])).body.results[0].status).toBe("accepted");
    const conflict = (await push(other, [b])).body.results[0];
    expect(conflict.status).toBe("conflict");
    expect(conflict.entityId).toBe(a.entityId);

    const d = today();
    const sheet = (await api(`/estates/${s.estate.id}/attendance/${d}`, { token: s.owner.token })).body;
    expect(sheet.openConflicts).toBe(1);
    expect(sheet.records[0].dayFraction).toBe("FULL");

    await push(s.supervisor, [await mutation(s.supervisor.deviceId, s.estate.id, "attendance_sheet", "submit", { businessDate: d })]);
    const blocked = await api(`/estates/${s.estate.id}/attendance/${d}/actions`, { token: s.owner.token, body: { action: "approve" } });
    expect(blocked.body.code).toBe("CONFLICTS_OPEN");

    const list = (await api(`/estates/${s.estate.id}/conflicts`, { token: s.owner.token })).body;
    expect(list).toHaveLength(1);
    expect((await api(`/conflicts/${list[0].id}/resolve`, { token: s.supervisor.token, body: { keep: "incoming", reason: "Half day per gang sheet" } })).status).toBe(403);
    const resolved = await api(`/conflicts/${list[0].id}/resolve`, { token: s.owner.token, body: { keep: "incoming", reason: "Half day per gang sheet" } });
    expect(resolved.body.record).toMatchObject({ dayFraction: "HALF", version: 2 });
    expect((await api(`/estates/${s.estate.id}/attendance/${d}/actions`, { token: s.owner.token, body: { action: "approve" } })).body.state).toBe("APPROVED");

    const history = (await api(`/audit/history?entityType=attendance_record&entityId=${a.entityId}&estateId=${s.estate.id}`, { token: s.owner.token })).body;
    expect(history.map((h: { change: string }) => h.change)).toEqual(["create", "conflict-resolve"]);
  });

  it("a stale edit from another device becomes a conflict", async () => {
    const s = await setupTenant();
    const other = await login(s.code, "sup1", "supervisor-pass-1");
    const a = await mutation(s.supervisor.deviceId, s.estate.id, "attendance_record", "upsert", present(s, s.w1.id));
    await push(s.supervisor, [a]);
    const e1 = await mutation(s.supervisor.deviceId, s.estate.id, "attendance_record", "upsert", present(s, s.w1.id, { remarks: "one" }), { entityId: a.entityId, baseVersion: 1 });
    const e2 = await mutation(other.deviceId, s.estate.id, "attendance_record", "upsert", present(s, s.w1.id, { remarks: "two" }), { entityId: a.entityId, baseVersion: 1 });
    expect((await push(s.supervisor, [e1])).body.results[0].status).toBe("accepted");
    expect((await push(other, [e2])).body.results[0]).toMatchObject({ status: "conflict", version: 2 });
  });

  it("prefills from the previous recorded day", async () => {
    const s = await setupTenant();
    const yesterday = new Date(Date.now() - 86_400_000);
    const y = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(yesterday);
    // Owner holds attendance.correct, so may enter a missed day.
    const ownerDevice = s.owner;
    const m = await mutation(ownerDevice.deviceId, s.estate.id, "attendance_record", "upsert", { ...present(s, s.w1.id), businessDate: y });
    expect((await push(ownerDevice, [m])).body.results[0].status).toBe("accepted");
    const sheet = (await api(`/estates/${s.estate.id}/attendance/${today()}`, { token: s.supervisor.token })).body;
    expect(sheet.prefill.fromDate).toBe(y);
    expect(sheet.prefill.assignments[0]).toMatchObject({ workerId: s.w1.id, fieldId: s.f1.id, jobTypeId: s.plk.id });
    // A supervisor cannot enter yesterday (attendance.backEntryDays = 0 until OC-86 is answered).
    const sup = await mutation(s.supervisor.deviceId, s.estate.id, "attendance_record", "upsert", { ...present(s, s.w2.id), businessDate: y });
    expect((await push(s.supervisor, [sup])).body.results[0].errorCode).toBe("DATE_NOT_ALLOWED");
  });

  it("an entry captured late in the evening offline still syncs the next morning under its own date", async () => {
    const s = await setupTenant();
    // Captured 30 minutes ago; business date is whatever the estate date was then.
    const capturedAt = new Date(Date.now() - 30 * 60_000);
    const d = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(capturedAt);
    const m = await mutation(s.supervisor.deviceId, s.estate.id, "attendance_record", "upsert", { ...present(s, s.w1.id), businessDate: d }, { capturedAt: capturedAt.toISOString() });
    expect((await push(s.supervisor, [m])).body.results[0].status).toBe("accepted");
    const ahead = await mutation(s.supervisor.deviceId, s.estate.id, "attendance_record", "upsert", present(s, s.w2.id), { capturedAt: new Date(Date.now() + 3_600_000).toISOString() });
    expect((await push(s.supervisor, [ahead])).body.results[0].errorCode).toBe("CLOCK_AHEAD");
    const old = await mutation(s.supervisor.deviceId, s.estate.id, "attendance_record", "upsert", present(s, s.w3.id), { capturedAt: new Date(Date.now() - 9 * 86_400_000).toISOString() });
    expect((await push(s.supervisor, [old])).body.results[0].errorCode).toBe("CAPTURE_TOO_OLD");
    expect(uuidv7()).toBeTruthy();
  });
});
