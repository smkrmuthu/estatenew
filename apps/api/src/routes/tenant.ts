import {
  attendanceCorrection,
  attendanceRemoval,
  conflictResolution,
  dailyLogCorrection,
  deleteMaster,
  estateInput,
  fieldInput,
  importCommit,
  importRequest,
  jobTypeInput,
  logKindInput,
  musterCorrection,
  settingChange,
  sheetAction,
  syncPush,
  varietyInput,
  workerInput,
} from "@cemms/contracts";
import { type ExportData, IMPORT_KINDS, type ImportKind, importTemplate, newFormatSheets, newFormatSheetsFor, oldFormatSheets, oldFormatSheetsFor } from "@cemms/domain";
import type { Context, Hono } from "hono";
import { z } from "zod";
import { AppError } from "../core/errors";
import { readJson } from "../core/http";
import { route } from "../core/registry";
import { callTenant } from "../core/tenant-stub";
import type { AppEnv } from "../core/types";
import { buildXlsx } from "../core/xlsx";
import type { TenantOp } from "../tenant/tenant-db";

const p = (c: Context<AppEnv>, name: string) => c.req.param(name) ?? "";
const day = (c: Context<AppEnv>) => ({ estateId: p(c, "estateId"), businessDate: p(c, "date") });
const version = (c: Context<AppEnv>) => {
  const v = c.req.header("if-match");
  return v && /^\d+$/.test(v.replaceAll('"', "")) ? Number(v.replaceAll('"', "")) : undefined;
};

export function tenantRoutes(app: Hono<AppEnv>) {
  const call =
    <K extends TenantOp>(op: K, input: (c: Context<AppEnv>) => Promise<unknown> | unknown, status: 200 | 201 = 200) =>
    async (c: Context<AppEnv>) =>
      c.json(await callTenant(c, op, await input(c)), status);

  route(
    app,
    { method: "get", path: "/reference", summary: "Master data for my estates (device bootstrap)", tag: "masters", auth: "bearer", permission: "masters.read" },
    call("org.reference", (c) => ({ includeInactive: c.req.query("inactive") === "1" })),
  );
  route(
    app,
    { method: "post", path: "/estates", summary: "Create an estate", tag: "masters", auth: "bearer", permission: "masters.write", body: estateInput },
    call("org.createEstate", readJson, 201),
  );
  route(
    app,
    { method: "post", path: "/fields", summary: "Create a field", tag: "masters", auth: "bearer", permission: "masters.write", body: fieldInput },
    call("org.upsertField", async (c) => ({ body: await readJson(c) }), 201),
  );
  route(
    app,
    { method: "put", path: "/fields/:id", summary: "Update a field (If-Match: version)", tag: "masters", auth: "bearer", permission: "masters.write", body: fieldInput },
    call("org.upsertField", async (c) => ({ id: p(c, "id"), baseVersion: version(c), body: await readJson(c) })),
  );
  route(
    app,
    { method: "post", path: "/varieties", summary: "Create a variety", tag: "masters", auth: "bearer", permission: "masters.write", body: varietyInput },
    call("org.upsertVariety", async (c) => ({ body: await readJson(c) }), 201),
  );
  route(
    app,
    { method: "put", path: "/varieties/:id", summary: "Update a variety", tag: "masters", auth: "bearer", permission: "masters.write", body: varietyInput },
    call("org.upsertVariety", async (c) => ({ id: p(c, "id"), baseVersion: version(c), body: await readJson(c) })),
  );
  route(
    app,
    { method: "post", path: "/job-types", summary: "Create a job type", tag: "masters", auth: "bearer", permission: "masters.write", body: jobTypeInput },
    call("org.upsertJobType", async (c) => ({ body: await readJson(c) }), 201),
  );
  route(
    app,
    { method: "put", path: "/job-types/:id", summary: "Update a job type", tag: "masters", auth: "bearer", permission: "masters.write", body: jobTypeInput },
    call("org.upsertJobType", async (c) => ({ id: p(c, "id"), baseVersion: version(c), body: await readJson(c) })),
  );
  route(
    app,
    { method: "post", path: "/workers", summary: "Create a worker", tag: "masters", auth: "bearer", permission: "masters.write", body: workerInput },
    call("org.upsertWorker", async (c) => ({ body: await readJson(c) }), 201),
  );
  route(
    app,
    { method: "put", path: "/workers/:id", summary: "Update a worker", tag: "masters", auth: "bearer", permission: "masters.write", body: workerInput },
    call("org.upsertWorker", async (c) => ({ id: p(c, "id"), baseVersion: version(c), body: await readJson(c) })),
  );

  route(
    app,
    {
      method: "post",
      path: "/workers/:id/delete",
      summary: "Delete a worker nothing refers to yet (reason required)",
      tag: "masters",
      auth: "bearer",
      permission: "masters.write",
      body: deleteMaster,
    },
    call("org.deleteWorker", async (c) => ({ id: p(c, "id"), body: await readJson(c) })),
  );
  route(
    app,
    { method: "post", path: "/fields/:id/delete", summary: "Delete a field nothing refers to yet (reason required)", tag: "masters", auth: "bearer", permission: "masters.write", body: deleteMaster },
    call("org.deleteField", async (c) => ({ id: p(c, "id"), body: await readJson(c) })),
  );

  route(app, { method: "get", path: "/imports/templates/:kind", summary: "CSV template for an import", tag: "imports", auth: "bearer" }, (c) => {
    const kind = p(c, "kind");
    if (!(IMPORT_KINDS as readonly string[]).includes(kind)) throw new AppError(404, "NOT_FOUND", "Unknown import");
    return c.body(importTemplate(kind as ImportKind), 200, { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${kind}.csv"` });
  });
  route(
    app,
    { method: "post", path: "/imports/preview", summary: "Check a CSV import and show what will change", tag: "imports", auth: "bearer", permission: "masters.import", body: importRequest },
    call("import.preview", readJson),
  );
  route(
    app,
    { method: "post", path: "/imports/commit", summary: "Apply a previewed CSV import (idempotent per file)", tag: "imports", auth: "bearer", permission: "masters.import", body: importCommit },
    call("import.commit", readJson),
  );

  route(
    app,
    { method: "get", path: "/admin/settings", summary: "Tenant settings with their gates", tag: "admin", auth: "bearer" },
    call("settings.list", () => ({})),
  );
  route(
    app,
    {
      method: "put",
      path: "/admin/settings/:key",
      summary: "Change a setting (refused in production while its question is open)",
      tag: "admin",
      auth: "bearer",
      permission: "settings.configure",
      body: settingChange.pick({ value: true }),
    },
    call("settings.change", async (c) => ({ key: p(c, "key"), value: ((await readJson(c)) as { value?: unknown }).value })),
  );
  route(
    app,
    { method: "get", path: "/admin/gates", summary: "Owner questions and their status for this tenant", tag: "admin", auth: "bearer" },
    call("gates.list", () => ({})),
  );
  route(
    app,
    { method: "put", path: "/admin/gates/:id", summary: "Record the owner's answer to a question", tag: "admin", auth: "bearer", permission: "settings.manage" },
    call("gates.record", async (c) => ({ id: p(c, "id"), body: await readJson(c) })),
  );
  route(
    app,
    { method: "get", path: "/admin/readiness", summary: "Open questions that block production for Phase 1A", tag: "admin", auth: "bearer", permission: "settings.manage" },
    call("admin.readiness", () => ({})),
  );
  route(
    app,
    { method: "post", path: "/admin/log-kinds", summary: "Create a Daily log reading type", tag: "admin", auth: "bearer", permission: "dailylog.configure", body: logKindInput },
    call("org.upsertLogKind", async (c) => ({ body: await readJson(c) }), 201),
  );
  route(
    app,
    { method: "put", path: "/admin/log-kinds/:id", summary: "Update a Daily log reading type", tag: "admin", auth: "bearer", permission: "dailylog.configure", body: logKindInput },
    call("org.upsertLogKind", async (c) => ({ id: p(c, "id"), baseVersion: version(c), body: await readJson(c) })),
  );

  route(
    app,
    {
      method: "get",
      path: "/estates/:estateId/attendance/:date",
      summary: "Attendance sheet for a day, with the previous day's assignments",
      tag: "attendance",
      auth: "bearer",
      permission: "attendance.read",
    },
    call("attendance.sheet", (c) => ({ ...day(c), shift: c.req.query("shift") })),
  );
  route(
    app,
    {
      method: "post",
      path: "/estates/:estateId/attendance/:date/actions",
      summary: "Approve or return a submitted sheet",
      tag: "attendance",
      auth: "bearer",
      permission: "attendance.approve",
      body: sheetAction,
    },
    call("attendance.sheetAction", async (c) => ({ ...day(c), body: await readJson(c) })),
  );
  route(
    app,
    {
      method: "post",
      path: "/attendance-records/:id/corrections",
      summary: "Correct a submitted record (reason required)",
      tag: "attendance",
      auth: "bearer",
      permission: "attendance.correct",
      body: attendanceCorrection,
    },
    call("attendance.correct", async (c) => ({ id: p(c, "id"), body: await readJson(c) })),
  );
  route(
    app,
    {
      method: "post",
      path: "/attendance-records/:id/removal",
      summary: "Remove a worker's mark for the day (reason required; the old entry is kept in the history)",
      tag: "attendance",
      auth: "bearer",
      permission: "attendance.correct",
      body: attendanceRemoval,
    },
    call("attendance.remove", async (c) => ({ id: p(c, "id"), body: await readJson(c) })),
  );
  route(
    app,
    { method: "get", path: "/estates/:estateId/conflicts", summary: "Open sync conflicts", tag: "sync", auth: "bearer", permission: "attendance.read" },
    call("conflicts.list", (c) => ({ estateId: p(c, "estateId") })),
  );
  route(
    app,
    {
      method: "post",
      path: "/conflicts/:id/resolve",
      summary: "Keep one version of a conflict (reason required)",
      tag: "sync",
      auth: "bearer",
      permission: "conflicts.resolve",
      body: conflictResolution,
    },
    call("conflicts.resolve", async (c) => ({ id: p(c, "id"), body: await readJson(c) })),
  );

  route(
    app,
    { method: "get", path: "/estates/:estateId/muster", summary: "Weigh-ins over a range of days (?from=&to=, up to 93 days)", tag: "muster", auth: "bearer", permission: "muster.read" },
    call("muster.range", (c) => ({ estateId: p(c, "estateId"), from: c.req.query("from") ?? "", to: c.req.query("to") ?? "" })),
  );
  route(app, { method: "get", path: "/estates/:estateId/muster/:date", summary: "Weigh-ins for a day", tag: "muster", auth: "bearer", permission: "muster.read" }, call("muster.list", day));
  route(
    app,
    { method: "get", path: "/estates/:estateId/muster-days/:date", summary: "Recent days of weigh-in totals up to a date", tag: "muster", auth: "bearer", permission: "muster.read" },
    call("muster.days", day),
  );
  route(
    app,
    { method: "post", path: "/muster-entries/:id/corrections", summary: "Correct a weigh-in (reason required)", tag: "muster", auth: "bearer", permission: "muster.correct", body: musterCorrection },
    call("muster.correct", async (c) => ({ id: p(c, "id"), body: await readJson(c) })),
  );
  route(
    app,
    { method: "get", path: "/estates/:estateId/daily-log/:date", summary: "Daily log readings for a day", tag: "dailylog", auth: "bearer", permission: "dailylog.read" },
    call("dailylog.list", day),
  );
  route(
    app,
    {
      method: "post",
      path: "/daily-log-entries/:id/corrections",
      summary: "Correct a reading (reason required)",
      tag: "dailylog",
      auth: "bearer",
      permission: "dailylog.correct",
      body: dailyLogCorrection,
    },
    call("dailylog.correct", async (c) => ({ id: p(c, "id"), body: await readJson(c) })),
  );

  route(
    app,
    { method: "post", path: "/sync/push", summary: "Upload device changes; per-item results", tag: "sync", auth: "bearer", permission: "sync.push", body: syncPush },
    call("sync.push", readJson),
  );
  route(
    app,
    { method: "get", path: "/estates/:estateId/reports/daily/:date", summary: "Daily summary (server-accepted data only)", tag: "reports", auth: "bearer", permission: "reports.read" },
    call("reports.daily", day),
  );
  route(
    app,
    { method: "get", path: "/estates/:estateId/reports/dashboard/:date", summary: "Dashboard figures (server-accepted data only)", tag: "reports", auth: "bearer", permission: "reports.read" },
    call("reports.dashboard", day),
  );
  route(
    app,
    {
      method: "get",
      path: "/reports/export",
      summary: "Excel file for every estate you may export, in one workbook (?format=old|new&from=&to=). Old format has a sheet per date and estate",
      tag: "reports",
      auth: "bearer",
      permission: "reports.workerDetail",
    },
    async (c) => {
      const format = c.req.query("format") === "old" ? "old" : "new";
      const from = c.req.query("from") ?? "";
      const to = c.req.query("to") ?? "";
      const all = (await callTenant(c, "reports.exportAll", { from, to, format })) as ExportData[];
      const sheets = format === "old" ? oldFormatSheetsFor(all) : newFormatSheetsFor(all);
      if (sheets.length === 0) throw new AppError(404, "NO_DATA", "There is no attendance or plucking in these dates");
      const name = `all-estates-${from}${to === from ? "" : `_to_${to}`}-${format === "old" ? "old-format" : "new-format"}.xlsx`;
      return c.body(buildXlsx(sheets).buffer as ArrayBuffer, 200, {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="${name}"`,
        "cache-control": "no-store",
      });
    },
  );
  route(
    app,
    {
      method: "get",
      path: "/estates/:estateId/reports/export",
      summary: "Excel file of attendance and plucking (?format=old|new&from=&to=). Old format is one sheet per date like the estate's daily sheet; new format is the app's own tables",
      tag: "reports",
      auth: "bearer",
      permission: "reports.workerDetail",
    },
    async (c) => {
      const format = c.req.query("format") === "old" ? "old" : "new";
      const from = c.req.query("from") ?? "";
      const to = c.req.query("to") ?? "";
      const data = (await callTenant(c, "reports.export", { estateId: p(c, "estateId"), from, to, format })) as ExportData;
      const sheets = format === "old" ? oldFormatSheets(data) : newFormatSheets(data);
      if (sheets.length === 0) throw new AppError(404, "NO_DATA", "There is no attendance or plucking in these dates");
      const name = `${data.estate.code}-${from}${to === from ? "" : `_to_${to}`}-${format === "old" ? "old-format" : "new-format"}.xlsx`;
      return c.body(buildXlsx(sheets).buffer as ArrayBuffer, 200, {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="${name}"`,
        "cache-control": "no-store",
      });
    },
  );
  route(
    app,
    { method: "get", path: "/estates/:estateId/reports/plucking", summary: "Weigh-ins over a date range by field and worker (?from=&to=)", tag: "reports", auth: "bearer", permission: "reports.read" },
    call("reports.plucking", (c) => ({ estateId: p(c, "estateId"), from: c.req.query("from") ?? "", to: c.req.query("to") ?? "" })),
  );
  route(
    app,
    { method: "get", path: "/estates/:estateId/daily-log", summary: "Daily log readings over a date range (?from=&to=)", tag: "dailylog", auth: "bearer", permission: "dailylog.read" },
    call("dailylog.range", (c) => ({ estateId: p(c, "estateId"), from: c.req.query("from") ?? "", to: c.req.query("to") ?? "" })),
  );
  route(
    app,
    { method: "get", path: "/estates/:estateId/workers/:workerId/attendance", summary: "A worker's recent attendance (?days=)", tag: "attendance", auth: "bearer", permission: "attendance.read" },
    call("attendance.workerHistory", (c) => ({ estateId: p(c, "estateId"), workerId: p(c, "workerId"), days: Number(c.req.query("days") ?? 30) || 30 })),
  );
  route(
    app,
    { method: "get", path: "/audit", summary: "Audit trail", tag: "audit", auth: "bearer", permission: "audit.read" },
    call("audit.list", (c) => ({ estateId: c.req.query("estateId"), entityType: c.req.query("entityType"), entityId: c.req.query("entityId"), limit: Number(c.req.query("limit") ?? 100) })),
  );
  route(
    app,
    { method: "get", path: "/audit/history", summary: "Every version of one record", tag: "audit", auth: "bearer", permission: "audit.read" },
    call("audit.history", (c) => z.object({ entityType: z.string(), entityId: z.string(), estateId: z.string() }).parse(c.req.query())),
  );
}
