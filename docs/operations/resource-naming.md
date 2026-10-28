# Cloudflare Resource Names

Only new `cemms-*` resources are used. The older `estate`, `estate-demo` Workers and `estate-db`, `estate-demo-db` D1 databases are never bound, migrated or changed.

| Resource | Local (dev) | Staging | Production |
|---|---|---|---|
| API Worker | `cemms-api-dev` | `cemms-api-staging` | `cemms-api` |
| Web Worker (static PWA) | `cemms-web-dev` | `cemms-web-staging` | `cemms-web` |
| Route / domain | localhost:5173 → :8787 | `estate-staging.oneuptech.co` (web), `/api/*` → API | `estate.oneuptech.co` (web), `/api/*` → API |
| Control D1 | `cemms-control-dev` (local only) | `cemms-control-staging` | `cemms-control-production` |
| Tenant databases | Durable Object class `TenantDb` (per Worker) | same class in `cemms-api-staging` | same class in `cemms-api` |
| R2 bucket | `cemms-files-dev` (local) | `cemms-files-staging` | `cemms-files-production` |
| Queue / dead letter | `cemms-jobs-dev` / `cemms-jobs-dlq-dev` | `cemms-jobs-staging` / `-dlq-staging` | `cemms-jobs-production` / `-dlq-production` |
| Rate limit namespaces | 4101, 4102 | 4201, 4202 | 4301, 4302 |
| Secrets | `.dev.vars` | `wrangler secret put --env staging` | `wrangler secret put --env production` |

Secrets per environment: `JWT_SECRET` (48+ random bytes), `MFA_ENC_KEY` (base64 of 32 random bytes), `PLATFORM_BOOTSTRAP_TOKEN` (32+ chars; remove after the first tenant is created).

Not yet created in the Cloudflare account (needs explicit go-ahead): the staging and production D1 databases, R2 buckets, queues, secrets, and the two custom domains. The `database_id` placeholders in `apps/api/wrangler.jsonc` must be filled after creating the D1 databases.
