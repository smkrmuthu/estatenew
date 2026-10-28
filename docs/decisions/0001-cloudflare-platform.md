# ADR-0001: Cloudflare-only platform

- Status: Accepted
- Source: CEMMS MVP Architecture and Technical Design, revision of 27 October 2026
- Approver: Project owner, 27 October 2026

## Decision

- API: Hono on Cloudflare Workers (`cemms-api`), modular monolith, route → service → repository.
- Control database: D1 `cemms-control-<env>` for tenants, users, credentials, sessions, refresh tokens, devices and role grants.
- Tenant data: one SQLite-backed Durable Object per tenant (class `TenantDb`), addressed by name from the tenant registry at runtime. New tenants need no deployment.
- Files and backups: R2 `cemms-files-<env>`. Jobs: Queues `cemms-jobs-<env>` and Cron Triggers. Short-lived cache: KV (never authoritative). Limits: Workers rate limiting binding and WAF.
- Web: one React + Vite installable web app (portal and supervisor phone), served as Workers static assets.

## Verified platform facts (checked 28 October 2026)

| Fact | Source | Effect on design |
|---|---|---|
| SQLite Durable Objects hold up to 10 GB each and are GA | Cloudflare changelog 2025-04-07 | A tenant over ~10 GB must move (see ADR-0001 follow-up: Hyperdrive path needs separate approval). Size is monitored per tenant. |
| PITR restores a Durable Object's SQLite to any point in the last 30 days (`getBookmarkForTime`, `onNextSessionRestoreBookmark`); not available in local development | Durable Objects SQLite storage API docs | Restore drill must run on staging, not locally. Nightly R2 copy is added for longer retention. |
| New Durable Object namespaces must use SQLite storage | Changelog 2026-07-09 | `TenantDb` is SQLite-backed. |
| New Workers should declare Durable Object classes in the `exports` field; `exports` and `migrations` are mutually exclusive and a Worker cannot go back to `migrations` once deployed with `exports` | Wrangler configuration docs | `cemms-api` uses `exports` from the start. |
| Rate limiting binding: `ratelimits` with integer `namespace_id`, period 10 or 60 s, approximate and per location | Workers rate limiting docs | Used for abuse limits; strict login lockout is enforced in D1, not by this binding. |
| `.sql` files are importable as strings by Wrangler | Changelog 2026-01-20 | Not relied on: tenant migrations are TypeScript string modules so Vitest and Wrangler load them the same way. |
| WebCrypto PBKDF2-SHA256 with 600,000 iterations works in local workerd (about 50 ms CPU) | Local probe with Wrangler 4.154.0 | Needs the Workers Paid plan (Free plan CPU limit is too low). Must be re-checked on staging before go-live. |

## Not claimed

Asia-Pacific placement (location hints) is not India-only data residency. An India-only tenant would need a separately approved PostgreSQL-in-India design through Hyperdrive.

## Legacy resources

The existing `estate`, `estate-demo` Workers and `estate-db`, `estate-demo-db` D1 databases are not used, bound, migrated or changed.
