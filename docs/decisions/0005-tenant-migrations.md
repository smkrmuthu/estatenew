# ADR-0005: Tenant database migrations

- Status: Accepted, 28 October 2026

## Decision

- Tenant migrations live in `apps/api/src/tenant/migrations/NNNN_name.ts` as ordered SQL strings. The control database uses Wrangler D1 migrations in `apps/api/db/control/`.
- Each `TenantDb` applies pending migrations in its constructor inside `blockConcurrencyWhile` and `transactionSync`, so no request runs against a half-migrated database. The Durable Object is single-threaded, which makes this the migration lock.
- `_migrations` records version, name, checksum and applied time. A checksum mismatch on an applied migration stops the object with an error (fail closed) and is reported in `/health/tenant`.
- Changes are expand, backfill, contract, and stay compatible with the previous Worker version.
- Recovery: before a risky migration, take a PITR bookmark (`getCurrentBookmark`) and record it; forward-fix by a new migration; full restore via `onNextSessionRestoreBookmark` (staging/production only).
