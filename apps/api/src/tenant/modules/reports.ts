import { addDays, formatKg, formatScaled, halfDays } from "@cemms/domain";
import { and, eq, gte, lte, or } from "drizzle-orm";
import { AppError } from "../../core/errors";
import type { TenantContext } from "../context";
import { attendanceRecords, attendanceSheets, dailylogEntries, deviceStatus, fields, jobTypes, logKinds, musterEntries, syncConflicts, workers } from "../schema";
import { getEstate } from "./organization";
import { setting } from "./settings";

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
    .where(and(or(eq(workers.estateId, estateId), eq(workers.allEstates, true)), eq(workers.active, true)))
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
    .where(and(or(eq(workers.estateId, estateId), eq(workers.allEstates, true)), eq(workers.active, true)))
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

  // Season totals need a start date (OC-75 open); without one the dashboard shows none.
  const seasonStart = setting(db, "season.startDate");
  const expectedG = db
    .select()
    .from(fields)
    .where(and(eq(fields.estateId, estateId), eq(fields.active, true)))
    .all()
    .reduce((sum, f) => sum + (f.expectedCherryG ?? 0), 0);
  const seasonCoffeeG = seasonStart
    ? db
        .select()
        .from(musterEntries)
        .where(
          and(
            eq(musterEntries.estateId, estateId),
            eq(musterEntries.status, "ACTIVE"),
            eq(musterEntries.crop, "COFFEE"),
            gte(musterEntries.businessDate, seasonStart),
            lte(musterEntries.businessDate, businessDate),
          ),
        )
        .all()
        .reduce((sum, e) => sum + e.netG, 0)
    : 0;

  return {
    estate: { id: estate.id, name: estate.name },
    businessDate,
    basis: "server-accepted" as const,
    season: {
      startDate: seasonStart || null,
      coffeeNetKg: formatKg(seasonCoffeeG),
      expectedKg: formatKg(expectedG),
      percent: expectedG > 0 && seasonStart ? Math.min(999, Math.round((seasonCoffeeG / expectedG) * 100)) : null,
    },
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

const MAX_RANGE_DAYS = 400;
function checkRange(from: string, to: string) {
  if (from > to) throw new AppError(422, "RANGE", "The start date is after the end date");
  if (daysBetween(from, to) > MAX_RANGE_DAYS) throw new AppError(422, "RANGE_TOO_LONG", `Choose at most ${MAX_RANGE_DAYS} days`);
}
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;

/**
 * Accepted weigh-ins over a range, by field and (for users allowed to see worker detail) by worker.
 * Coffee and pepper are kept apart. No pay or rate is worked out here; payroll is deferred.
 */
export function pluckingReport(ctx: TenantContext, estateId: string, from: string, to: string) {
  ctx.require("reports.read", estateId);
  checkRange(from, to);
  getEstate(ctx.db, estateId);
  const db = ctx.db;
  const entries = db
    .select()
    .from(musterEntries)
    .where(and(eq(musterEntries.estateId, estateId), eq(musterEntries.status, "ACTIVE"), gte(musterEntries.businessDate, from), lte(musterEntries.businessDate, to)))
    .all();
  const fieldRows = new Map(
    db
      .select()
      .from(fields)
      .where(eq(fields.estateId, estateId))
      .all()
      .map((f) => [f.id, f]),
  );
  const workerRows = new Map(
    db
      .select()
      .from(workers)
      .where(or(eq(workers.estateId, estateId), eq(workers.allEstates, true)))
      .all()
      .map((w) => [w.id, w]),
  );
  const kg = (g: number) => formatKg(g);
  const group = <T extends string>(keyOf: (e: (typeof entries)[number]) => T) => {
    const m = new Map<T, { entries: number; coffeeG: number; pepperG: number; workerDays: Set<string>; workers: Set<string>; days: Set<string>; bestDayG: Map<string, number> }>();
    for (const e of entries) {
      const k = keyOf(e);
      const g = m.get(k) ?? { entries: 0, coffeeG: 0, pepperG: 0, workerDays: new Set(), workers: new Set(), days: new Set(), bestDayG: new Map() };
      g.entries++;
      if (e.crop === "COFFEE") g.coffeeG += e.netG;
      else g.pepperG += e.netG;
      g.workerDays.add(`${e.workerId}|${e.businessDate}`);
      g.workers.add(e.workerId);
      g.days.add(e.businessDate);
      g.bestDayG.set(e.businessDate, (g.bestDayG.get(e.businessDate) ?? 0) + e.netG);
      m.set(k, g);
    }
    return m;
  };
  const byField = [...group((e) => e.fieldId)].map(([fieldId, g]) => ({
    fieldId,
    field: fieldRows.get(fieldId)?.name ?? "?",
    entries: g.entries,
    workerDays: g.workerDays.size,
    coffeeNetKg: kg(g.coffeeG),
    pepperNetKg: kg(g.pepperG),
    coffeeNetG: g.coffeeG,
    coffeePerWorkerDayKg: g.workerDays.size ? kg(Math.round(g.coffeeG / g.workerDays.size)) : "0.000",
  }));
  const detail = ctx.can("reports.workerDetail", estateId);
  const byWorker = detail
    ? [...group((e) => e.workerId)]
        .map(([workerId, g]) => ({
          workerId,
          worker: workerRows.get(workerId)?.name ?? "?",
          employeeCode: workerRows.get(workerId)?.employeeCode ?? "",
          days: g.days.size,
          entries: g.entries,
          coffeeNetKg: kg(g.coffeeG),
          pepperNetKg: kg(g.pepperG),
          coffeeNetG: g.coffeeG,
          bestDayKg: kg(Math.max(0, ...g.bestDayG.values())),
        }))
        .sort((a, b) => b.coffeeNetG - a.coffeeNetG)
    : null;
  return {
    estate: { id: estateId },
    from,
    to,
    basis: "server-accepted" as const,
    totals: {
      entries: entries.length,
      coffeeNetKg: kg(entries.filter((e) => e.crop === "COFFEE").reduce((s, e) => s + e.netG, 0)),
      pepperNetKg: kg(entries.filter((e) => e.crop === "PEPPER").reduce((s, e) => s + e.netG, 0)),
    },
    byField: byField.sort((a, b) => b.coffeeNetG - a.coffeeNetG),
    byWorker,
  };
}

/** Daily log readings over a range, with the kinds and how many readings each should have per day. */
export function dailyLogRange(ctx: TenantContext, estateId: string, from: string, to: string) {
  ctx.require("dailylog.read", estateId);
  checkRange(from, to);
  getEstate(ctx.db, estateId);
  const db = ctx.db;
  const kinds = db.select().from(logKinds).all();
  const rows = db
    .select()
    .from(dailylogEntries)
    .where(and(eq(dailylogEntries.estateId, estateId), eq(dailylogEntries.status, "ACTIVE"), gte(dailylogEntries.businessDate, from), lte(dailylogEntries.businessDate, to)))
    .all();
  return {
    from,
    to,
    kinds: kinds.map((k) => ({ id: k.id, label: k.label, unit: k.unit, decimals: k.decimals, valueType: k.valueType, expectedPerDay: k.expectedPerDay, active: k.active })),
    readings: rows
      .map((r) => ({ id: r.id, businessDate: r.businessDate, readingAt: r.readingAt, kindId: r.kindId, valueScaled: r.valueScaled, valueText: r.valueText, remarks: r.remarks }))
      .sort((a, b) => a.readingAt.localeCompare(b.readingAt)),
  };
}

/** The last days of one worker's attendance on this estate. */
export function workerHistory(ctx: TenantContext, estateId: string, workerId: string, days: number) {
  ctx.require("attendance.read", estateId);
  const db = ctx.db;
  const worker = db
    .select()
    .from(workers)
    .where(and(eq(workers.id, workerId), or(eq(workers.estateId, estateId), eq(workers.allEstates, true))))
    .get();
  if (!worker) throw new AppError(404, "NOT_FOUND", "Worker not found on this estate");
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
  const rows = db
    .select()
    .from(attendanceRecords)
    .where(and(eq(attendanceRecords.estateId, estateId), eq(attendanceRecords.workerId, workerId)))
    .all()
    .sort((a, b) => b.businessDate.localeCompare(a.businessDate))
    .slice(0, Math.min(Math.max(days, 1), 120));
  return {
    worker: { id: worker.id, name: worker.name, employeeCode: worker.employeeCode },
    records: rows.map((r) => ({
      businessDate: r.businessDate,
      statusCode: r.statusCode,
      dayFraction: r.dayFraction,
      field: r.fieldId ? (fieldName.get(r.fieldId) ?? null) : null,
      job: r.jobTypeId ? (jobName.get(r.jobTypeId) ?? null) : null,
      remarks: r.remarks,
    })),
    daysWorked: rows.reduce((s, r) => s + (r.presence === "PRESENT" ? (r.dayFraction === "HALF" ? 0.5 : 1) : 0), 0),
  };
}
