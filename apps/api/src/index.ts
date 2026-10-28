import { Hono } from "hono";
import { requireAuth } from "./auth/middleware";
import { runAllBackups } from "./core/backup";
import { problemResponse } from "./core/errors";
import { clientIp, rateLimit, requestId, sameOriginOnly, securityHeaders } from "./core/http";
import { log } from "./core/log";
import { openApiDocument } from "./core/registry";
import type { AppEnv } from "./core/types";
import { authRoutes } from "./routes/auth";
import { backupRoutes } from "./routes/backups";
import { platformRoutes } from "./routes/platform";
import { tenantRoutes } from "./routes/tenant";
import { userRoutes } from "./routes/users";

export { TenantDb } from "./tenant/tenant-db";

const api = new Hono<AppEnv>();
api.get("/health", (c) => c.json({ ok: true, environment: c.env.ENVIRONMENT }));
api.get("/openapi.json", (c) => c.json(openApiDocument()));
authRoutes(api);
platformRoutes(api);

const secured = new Hono<AppEnv>();
secured.use("*", requireAuth);
secured.use(
  "*",
  rateLimit("API_LIMIT", (c) => `s:${c.get("auth")?.session.id ?? clientIp(c)}`),
);
userRoutes(secured);
backupRoutes(secured);
tenantRoutes(secured);
api.route("/", secured);

const app = new Hono<AppEnv>();
app.use("*", requestId, securityHeaders, sameOriginOnly);
app.onError((err, c) => {
  const res = problemResponse(c, err);
  if (res.status >= 500) log("error", "request.failed", { requestId: c.get("requestId"), path: new URL(c.req.url).pathname, error: (err as Error).message });
  return res;
});
app.notFound((c) => c.json({ type: "about:blank", title: "Not found", status: 404, code: "NOT_FOUND", requestId: c.get("requestId") }, 404));
app.route("/api/v1", api);

export default {
  fetch: app.fetch,

  /** Outbox events. Phase 1A has no subscribers; consumers must stay idempotent on eventId. */
  async queue(batch: MessageBatch<{ eventId: string; type: string }>) {
    for (const m of batch.messages) {
      log("info", "outbox.event", { eventId: m.body.eventId, type: m.body.type });
      m.ack();
    }
  },

  /** Nightly encrypted copy of the control database and every tenant database to R2 (on top of 30-day point-in-time restore). */
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      runAllBackups(env, "nightly").then((run) => {
        if (!run.ok) log("error", "backup.run.incomplete", { failed: run.results.filter((r) => !r.ok).map((r) => `${r.kind}:${r.code ?? ""}`) });
      }),
    );
  },
} satisfies ExportedHandler<Env, { eventId: string; type: string }>;
