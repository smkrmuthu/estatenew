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

## One code base, separate environments

Production is not a separate code base. Staging and production run the same commit of `main`; only the environment differs (`--env staging` or `--env production` in `wrangler.jsonc`). Each environment has its own address, Workers (`cemms-api-staging` and `cemms-web-staging`; `cemms-api` and `cemms-web` in production), control database, files bucket, queues, Durable Object data and secrets. Staging never binds a production resource, and production data never flows to staging. The production resources are configured but not created yet; creating them is part of go-live and needs the project lead's explicit go-ahead.

Deploys can be run from CI or by hand. CI (`.github/workflows/ci.yml`) deploys staging after every green push to `main` and deploys production only from a manual run with `deploy_production` approved on the protected `production` environment. Whether the GitHub secrets and the protected environment are set up has not been verified. The team has so far deployed staging by hand with `wrangler deploy --env staging`; production is deployed the same way with `--env production`, only after the project lead says so.

## Fixing a production bug

1. Reproduce it and fix it on `main`, with a test that would have caught it.
2. `npm run check` must pass (lint, boundaries, register, types, tests, build). Never deploy after a failed check.
3. Deploy the commit to staging and check the fix there, on a phone where it concerns capture or sync.
4. Deploy the same commit to production after the project lead's go-ahead, and confirm `/api/v1/health` and the live web bundle.
5. Watch the first entries after the release: sync outcomes, the conflict list and the nightly backup result.

An urgent fix may take minutes, but it still goes through steps 2 to 4. A fix that touches attendance, weigh-in, sync or sign-in is never deployed untested. If a fix needs a database change it must be additive (see Migrations); anything else is planned as expand, backfill, contract over more than one release.

If a release makes things worse, roll back first (below) and fix afterwards.

## Release habits

- Release outside morning attendance and evening weigh-in.
- Keep paper registers as the fallback for the first one to two weeks after go-live.
- Test on staging with real phones for a few days before each release.
- For a risky change once production is live, use a gradual deployment (a small share of traffic on the new version first), then promote it.

## Rollback

- Code: redeploy the previous Worker version (Workers keeps versions). Migrations are additive, so the previous version still works with the new schema.
- Data: forward-fix with a new migration or a correction; for damage, restore one tenant with PITR (last 30 days) or from the nightly R2 copy. Rollback never discards writes made after the release: restore into a scratch tenant and re-apply those writes when needed.
- Phones: queued entries stay in IndexedDB through any server rollback and upload again; the server deduplicates by mutation id.

## Go-live fallback

If anything blocks on 1 November, the estate keeps paper registers for that day and the entries are typed in later through the manager back-entry path (31 days).
