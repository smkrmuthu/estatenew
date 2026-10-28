# Rollout and Rollback

## Order

1. CI green on `main` (lint, boundaries, register, types, tests, build, migrations, audit, secret scan).
2. Automatic staging deploy: control migrations (`wrangler d1 migrations apply --env staging --remote`), API, web, health check.
3. Owner and operations acceptance on staging with synthetic data: sign-in with MFA, roll call, weigh-in for coffee and pepper, Daily log, airplane-mode capture and later sync, conflict resolution, correction with reason, daily summary.
4. Restore drill on staging: take a Durable Object bookmark, change data, restore with `onNextSessionRestoreBookmark`; restore the nightly R2 copy to a scratch tenant.
5. Production: manual `workflow_dispatch` with `deploy_production`, approved on the protected `production` environment. Create the first tenant with the bootstrap token, then remove the token.
6. Import real masters (estates, varieties, job types, fields, workers) with preview; owner confirms counts.

## Migrations

Control D1: Wrangler migrations, backward compatible (expand, backfill, contract). Tenant databases: applied by each `TenantDb` on first use under `blockConcurrencyWhile`; a checksum mismatch stops that tenant with `MIGRATION_FAILED` (visible in `health()`), never a half-applied state.

## Rollback

- Code: redeploy the previous Worker version (Workers keeps versions). Migrations are additive, so the previous version still works with the new schema.
- Data: forward-fix with a new migration or a correction; for damage, restore one tenant with PITR (last 30 days) or from the nightly R2 copy. Rollback never discards writes made after the release: restore into a scratch tenant and re-apply those writes when needed.
- Phones: queued entries stay in IndexedDB through any server rollback and upload again; the server deduplicates by mutation id.

## Go-live fallback

If anything blocks on 1 November, the estate keeps paper registers for that day and the entries are typed in later through the manager back-entry path (31 days).
