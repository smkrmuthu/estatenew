# ADR-0008: Configuration gates for unconfirmed behaviour

- Status: Accepted, 28 October 2026

## Decision

- Behaviour that the owner has not confirmed is a tenant setting (`settings` table in the tenant database) with a `basis`: `confirmed`, `proposed` or `tenant-choice`, and the register item it depends on.
- Code reads settings through `packages/domain/src/settings.ts`, which knows each key's default, validation and gate.
- In the `production` environment, a setting with basis `proposed` whose gate is still open cannot be switched on; the API refuses with `GATE_NOT_CONFIRMED`. Development and staging may use proposed values for testing, shown with a "Proposed, not confirmed" badge.
- `GET /api/v1/admin/readiness` lists open gates that block production for the tenant's enabled features.
