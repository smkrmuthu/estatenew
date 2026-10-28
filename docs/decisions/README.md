# Decision Log

Each decision records its source, approver and date. Business decisions come only from the owner confirmation (see `../owner-confirmations.md`); technology decisions come from the 27 October 2026 architecture revision or a later approved record.

| ID | Decision | Status | Source | Approver | Date |
|---|---|---|---|---|---|
| [ADR-0001](0001-cloudflare-platform.md) | Cloudflare-only platform: Hono Workers, D1 control, SQLite Durable Object per tenant | Accepted | Architecture revision 27 Oct 2026 | Project owner | 2026-10-27 |
| [ADR-0002](0002-repository-and-tooling.md) | npm workspaces monorepo, Biome, Vitest in the Workers runtime | Accepted | Implementation brief 28 Oct 2026 | Engineering | 2026-10-28 |
| [ADR-0003](0003-identity-and-tenancy-model.md) | One user belongs to one tenant; roles are estate-scoped | Interim; AQ-1 is a platform decision, not for the estate owner | Architecture default | Platform owner to decide | 2026-10-28 |
| [ADR-0004](0004-authentication.md) | PBKDF2-SHA256 600k, 15-minute access JWT in memory, rotating refresh cookie, TOTP for the Owner in production only | Accepted | Architecture revision 27 Oct 2026 | Project owner | 2026-10-27 |
| [ADR-0005](0005-tenant-migrations.md) | Versioned SQL migrations applied inside each tenant Durable Object on first use | Accepted | Implementation brief | Engineering | 2026-10-28 |
| [ADR-0006](0006-offline-sync.md) | Mutation outbox in IndexedDB, idempotent per-item sync results, conflicts never auto-resolved | Accepted | Architecture offline sync design | Project owner | 2026-10-27 |
| [ADR-0007](0007-quantities.md) | Weights stored as integer grams; no float business arithmetic | Accepted | Implementation brief | Engineering | 2026-10-28 |
| [ADR-0008](0008-configuration-gates.md) | Unconfirmed behaviour lives in tenant settings marked proposed; production refuses to activate them | Accepted | Implementation brief | Engineering | 2026-10-28 |
| [ADR-0009](0009-chained-pbkdf2.md) | Six chained 100k PBKDF2 rounds (Workers caps one call at 100k) | Accepted | Staging deploy finding | Project owner | 2026-10-28 |
| [ADR-0010](0010-site-address-decides-tenant.md) | Each tenant has its own address (Glazebrooke: glazebrooke-staging / glazebrooke.oneuptech.co); no group code on sign-in | Accepted | Project owner | Project owner | 2026-10-28 |
| [ADR-0011](0011-masters-follow-the-prototype.md) | Masters and Users forms follow the prototype: worker type and gender, field subdivisions, job plucking flag, log kind expected per day | Interim | Project lead instruction | Muthu Kumar | 2026-10-28 |
