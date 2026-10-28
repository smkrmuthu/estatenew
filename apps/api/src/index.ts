import { Hono } from "hono";
import { requireAuth } from "./auth/middleware";
import { controlDb } from "./control/db";
import { tenants } from "./control/schema";
import { encryptSecret } from "./core/crypto";
import { problemResponse } from "./core/errors";
import { clientIp, rateLimit, requestId, sameOriginOnly, securityHeaders } from "./core/http";
import { log } from "./core/log";
import { openApiDocument } from "./core/registry";
import { tenantStub } from "./core/tenant-stub";
import type { AppEnv } from "./core/types";
import { authRoutes } from "./routes/auth";
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

  /** Nightly encrypted copy of every tenant database to R2 (on top of 30-day PITR). */
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    const rows = await controlDb(env).select().from(tenants).all();
    const date = new Date().toISOString().slice(0, 10);
    ctx.waitUntil(
      Promise.all(
        rows.map(async (t) => {
          try {
            const snapshot = await tenantStub(env, t.dbName).snapshot(t.id);
            const body = await encryptSecret(snapshot, env.MFA_ENC_KEY);
            await env.FILES.put(`tenants/${t.id}/backups/${date}.json.enc`, body, { customMetadata: { tenantId: t.id, kind: "nightly-snapshot" } });
            log("info", "backup.done", { tenantId: t.id, bytes: body.length });
          } catch (e) {
            log("error", "backup.failed", { tenantId: t.id, error: (e as Error).message });
          }
        }),
      ),
    );
  },
} satisfies ExportedHandler<Env, { eventId: string; type: string }>;
