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

## Created

Staging, 28 October 2026 (Asia-Pacific): D1 `cemms-control-staging` (`575c5f48-1b31-4c4e-a4d8-b89f0975a665`), R2 `cemms-files-staging`, queues `cemms-jobs-staging` and `cemms-jobs-dlq-staging`, Workers `cemms-api-staging` and `cemms-web-staging`, custom domain `estate-staging.oneuptech.co`, secrets set at deploy. The generated secret values are kept only in `apps/api/.secrets.staging.json` (git-ignored, mode 600); move them to a password manager. A synthetic tenant `demo` exists on staging; its sign-ins are in `apps/api/.secrets.staging-users.json`.

Production: not created. Needs its own go-ahead (D1 `cemms-control-production`, R2, queues, secrets, `estate.oneuptech.co`).

Zone note: Cloudflare Web Analytics injects a beacon script that the app's CSP blocks (console error only). Turn off automatic injection for the zone, or leave it blocked.
