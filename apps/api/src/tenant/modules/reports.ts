import { addDays, formatKg, formatScaled, halfDays } from "@cemms/domain";
import { and, eq, gte, lte } from "drizzle-orm";
import type { TenantContext } from "../context";
import { attendanceRecords, attendanceSheets, dailylogEntries, deviceStatus, fields, jobTypes, logKinds, musterEntries, syncConflicts, workers } from "../schema";
import { getEstate } from "./organization";

/**
 * Daily summary for one estate and day. Counts only records the server has accepted, and
 * reports separately what devices said is still waiting (OC-102 open).
 */
export function dailySummary(ctx: TenantContext, estateId: string, businessDate: string) {
  ctx.require("reports.read", estateId);
  const estate = getEstate(ctx.db, estateId);
  const db = ctx.db;
  const sheet = db
    .select()
    .from(attendanceSheets)
    .where(and(eq(attendanceSheets.estateId, estateId), eq(attendanceSheets.businessDate, businessDate)))
    .get();
  const records = sheet ? db.select().from(attendanceRecords).where(eq(attendanceRecords.sheetId, sheet.id)).all() : [];
  const fieldName = new Map(
    db
      .select()
      .from(fields)
      .where(eq(fields.estateId, estateId))
      .all()
      .map((f) => [f.id, f.name]),
  );
  const jobName = new Map(
    db
      .select()
      .from(jobTypes)
      .all()
      .map((j) => [j.id, j.name]),
  );
  const activeWorkers = db
    .select()
    .from(workers)
    .where(and(eq(workers.estateId, estateId), eq(workers.active, true)))
    .all().length;

  const byFieldJob = new Map<string, { field: string; job: string; workers: number; halfDays: number }>();
  for (const r of records) {
    if (r.presence !== "PRESENT") continue;
    const key = `${r.fieldId}|${r.jobTypeId}`;
    const cur = byFieldJob.get(key) ?? { field: fieldName.get(r.fieldId ?? "") ?? "?", job: jobName.get(r.jobTypeId ?? "") ?? "?", workers: 0, halfDays: 0 };
    cur.workers++;
    cur.halfDays += halfDays({ presence: "PRESENT", dayFraction: r.dayFraction });
    byFieldJob.set(key, cur);
  }

  const entries = db
    .select()
    .from(musterEntries)
    .where(and(eq(musterEntries.estateId, estateId), eq(musterEntries.businessDate, businessDate), eq(musterEntries.status, "ACTIVE")))
    .all();
  const byCrop = new Map<string, { crop: string; entries: number; netG: number; workers: Set<string> }>();
  const byCropField = new Map<string, { crop: string; field: string; netG: number }>();
  const perWorker = new Map<string, number>();
  for (const e of entries) {
    const c = byCrop.get(e.crop) ?? { crop: e.crop, entries: 0, netG: 0, workers: new Set<string>() };
    c.entries++;
    c.netG += e.netG;
    c.workers.add(e.workerId);
    byCrop.set(e.crop, c);
    const k = `${e.crop}|${e.fieldId}`;
    const cf = byCropField.get(k) ?? { crop: e.crop, field: fieldName.get(e.fieldId) ?? "?", netG: 0 };
    cf.netG += e.netG;
    byCropField.set(k, cf);
    perWorker.set(`${e.crop}|${e.workerId}`, (perWorker.get(`${e.crop}|${e.workerId}`) ?? 0) + 1);
  }

  const kinds = new Map(
    db
      .select()
      .from(logKinds)
      .all()
      .map((k) => [k.id, k]),
  );
  const readings = db
    .select()
    .from(dailylogEntries)
    .where(and(eq(dailylogEntries.estateId, estateId), eq(dailylogEntries.businessDate, businessDate), eq(dailylogEntries.status, "ACTIVE")))
    .all()
    .map((r) => {
      const k = kinds.get(r.kindId);
      return { kind: k?.label ?? "?", unit: k?.unit ?? null, readingAt: r.readingAt, value: r.valueText ?? formatScaled(r.valueScaled ?? 0, k?.decimals ?? 0) };
    })
    .sort((a, b) => a.readingAt.localeCompare(b.readingAt));

  const devices = db
    .select()
    .from(deviceStatus)
    .all()
    .filter((d) => (JSON.parse(d.estateIdsJson) as string[]).includes(estateId));
  const waiting = devices.filter((d) => d.pendingCount > 0);
  const openConflicts = db
    .select()
    .from(syncConflicts)
    .where(and(eq(syncConflicts.estateId, estateId), eq(syncConflicts.state, "OPEN")))
    .all().length;

  return {
    estate: { id: estate.id, code: estate.code, name: estate.name },
    businessDate,
    basis: "server-accepted" as const,
    attendance: {
      sheetState: sheet?.state ?? "NOT_STARTED",
      marked: records.length,
      activeWorkers,
      present: records.filter((r) => r.presence === "PRESENT").length,
      halfDayCount: records.filter((r) => r.presence === "PRESENT" && r.dayFraction === "HALF").length,
      absent: records.filter((r) => r.presence === "ABSENT").length,
      manDays: formatScaled(records.reduce((s, r) => s + halfDays({ presence: r.presence as "PRESENT", dayFraction: r.dayFraction }), 0) * 5, 1),
      byFieldJob: [...byFieldJob.values()].map((x) => ({ ...x, manDays: formatScaled(x.halfDays * 5, 1) })),
    },
    weighIn: {
      byCrop: [...byCrop.values()].map((c) => ({ crop: c.crop, entries: c.entries, workers: c.workers.size, netKg: formatKg(c.netG) })),
      byCropField: [...byCropField.values()].map((c) => ({ crop: c.crop, field: c.field, netKg: formatKg(c.netG) })),
      workersWithSeveralEntries: [...perWorker.values()].filter((n) => n > 1).length,
    },
    dailyLog: readings,
    sync: {
      openConflicts,
      devicesWaiting: waiting.length,
      entriesWaitingOnDevices: waiting.reduce((s, d) => s + d.pendingCount, 0),
      lastDeviceSyncAt:
        devices
          .map((d) => d.lastSyncAt)
          .sort()
          .at(-1) ?? null,
      note: "Counts include only entries the server has received. Entries still waiting on phones are listed separately.",
    },
  };
}

const DASHBOARD_DAYS = 14;

/**
 * Dashboard figures for one estate: today's roll call, the last 14 days of accepted weigh-ins,
 * and what needs a person's attention. Like the daily summary it counts only server-accepted
 * records. Season totals and targets are left out until the season start and expected crop are
 * confirmed (OC-100 and the owner's targets are open).
 */
export function dashboard(ctx: TenantContext, estateId: string, businessDate: string) {
  ctx.require("reports.read", estateId);
  const estate = getEstate(ctx.db, estateId);
  const db = ctx.db;
  const from = addDays(businessDate, -(DASHBOARD_DAYS - 1));

  const sheets = db
    .select()
    .from(attendanceSheets)
    .where(and(eq(attendanceSheets.estateId, estateId), gte(attendanceSheets.businessDate, from), lte(attendanceSheets.businessDate, businessDate)))
    .all();
  const today = sheets.find((s) => s.businessDate === businessDate);
  const todayRecords = today ? db.select().from(attendanceRecords).where(eq(attendanceRecords.sheetId, today.id)).all() : [];
  const activeWorkers = db
    .select()
    .from(workers)
    .where(and(eq(workers.estateId, estateId), eq(workers.active, true)))
    .all().length;

  const entries = db
    .select()
    .from(musterEntries)
    .where(and(eq(musterEntries.estateId, estateId), eq(musterEntries.status, "ACTIVE"), gte(musterEntries.businessDate, from), lte(musterEntries.businessDate, businessDate)))
    .all();
  const days = Array.from({ length: DASHBOARD_DAYS }, (_, i) => {
    const date = addDays(from, i);
    const net = (crop: string) => entries.filter((e) => e.businessDate === date && e.crop === crop).reduce((s, e) => s + e.netG, 0);
    return { date, coffeeNetKg: formatKg(net("COFFEE")), pepperNetKg: formatKg(net("PEPPER")), coffeeNetG: net("COFFEE"), pepperNetG: net("PEPPER") };
  });
  const todayEntries = entries.filter((e) => e.businessDate === businessDate);

  const readingsToday = db
    .select()
    .from(dailylogEntries)
    .where(and(eq(dailylogEntries.estateId, estateId), eq(dailylogEntries.businessDate, businessDate), eq(dailylogEntries.status, "ACTIVE")))
    .all().length;
  const openConflicts = db
    .select()
    .from(syncConflicts)
    .where(and(eq(syncConflicts.estateId, estateId), eq(syncConflicts.state, "OPEN")))
    .all().length;
  const waiting = db
    .select()
    .from(deviceStatus)
    .all()
    .filter((d) => d.pendingCount > 0 && (JSON.parse(d.estateIdsJson) as string[]).includes(estateId));

  return {
    estate: { id: estate.id, name: estate.name },
    businessDate,
    basis: "server-accepted" as const,
    today: {
      sheetState: today?.state ?? "NOT_STARTED",
      activeWorkers,
      marked: todayRecords.length,
      present: todayRecords.filter((r) => r.presence === "PRESENT").length,
      halfDayCount: todayRecords.filter((r) => r.presence === "PRESENT" && r.dayFraction === "HALF").length,
      absent: todayRecords.filter((r) => r.presence === "ABSENT").length,
      weighIns: todayEntries.length,
      coffeeNetKg: formatKg(todayEntries.filter((e) => e.crop === "COFFEE").reduce((s, e) => s + e.netG, 0)),
      pepperNetKg: formatKg(todayEntries.filter((e) => e.crop === "PEPPER").reduce((s, e) => s + e.netG, 0)),
      dailyLogReadings: readingsToday,
    },
    days,
    attention: {
      sheetsAwaitingApproval: sheets
        .filter((s) => s.state === "SUBMITTED")
        .map((s) => ({ date: s.businessDate, submittedBy: s.submittedBy }))
        .sort((a, b) => a.date.localeCompare(b.date)),
      openConflicts,
      devicesWaiting: waiting.length,
      entriesWaitingOnDevices: waiting.reduce((s, d) => s + d.pendingCount, 0),
    },
  };
}
