# Cloudflare Resource Names

Only new `cemms-*` resources are used. The older `estate`, `estate-demo` Workers and `estate-db`, `estate-demo-db` D1 databases are never bound, migrated or changed.

| Resource | Local (dev) | Staging | Production |
|---|---|---|---|
| API Worker | `cemms-api-dev` | `cemms-api-staging` | `cemms-api` |
| Web Worker (static PWA) | `cemms-web-dev` | `cemms-web-staging` | `cemms-web` |
| Route / domain | localhost:5173 → :8787 | `glazebrooke-staging.oneuptech.co` (web), `/api/*` → API | `glazebrooke.oneuptech.co` (web), `/api/*` → API |
| Control D1 | `cemms-control-dev` (local only) | `cemms-control-staging` | `cemms-control-production` |
| Tenant databases | Durable Object class `TenantDb` (per Worker) | same class in `cemms-api-staging` | same class in `cemms-api` |
| R2 bucket | `cemms-files-dev` (local) | `cemms-files-staging` | `cemms-files-production` |
| Queue / dead letter | `cemms-jobs-dev` / `cemms-jobs-dlq-dev` | `cemms-jobs-staging` / `-dlq-staging` | `cemms-jobs-production` / `-dlq-production` |
| Rate limit namespaces | 4101, 4102 | 4201, 4202 | 4301, 4302 |
| Secrets | `.dev.vars` | `wrangler secret put --env staging` | `wrangler secret put --env production` |

Secrets per environment: `JWT_SECRET` (48+ random bytes), `MFA_ENC_KEY` (base64 of 32 random bytes), `PLATFORM_BOOTSTRAP_TOKEN` (32+ chars; remove after the first tenant is created).

## Created

Staging, 28 October 2026 (Asia-Pacific): D1 `cemms-control-staging` (`575c5f48-1b31-4c4e-a4d8-b89f0975a665`), R2 `cemms-files-staging`, queues `cemms-jobs-staging` and `cemms-jobs-dlq-staging`, Workers `cemms-api-staging` and `cemms-web-staging`, custom domain `glazebrooke-staging.oneuptech.co` (the earlier `estate-staging.oneuptech.co` was detached), secrets set at deploy. The generated secret values are kept only in `apps/api/.secrets.staging.json` (git-ignored, mode 600); move them to a password manager. Tenant `glazebrooke` (synthetic workers and fields) is mapped to `glazebrooke-staging.oneuptech.co`; its sign-ins are in `apps/api/.secrets.staging-glazebrooke-users.json`. An older synthetic tenant `demo` has no address (`.secrets.staging-demo-users.json`).

Production: not created. Needs its own go-ahead after staging validation (D1 `cemms-control-production`, R2, queues, secrets, `glazebrooke.oneuptech.co`).

Zone note: Cloudflare Web Analytics injects a beacon script that the app's CSP blocks (console error only). Turn off automatic injection for the zone, or leave it blocked.
