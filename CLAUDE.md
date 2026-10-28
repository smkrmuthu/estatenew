# CEMMS Project Instructions

## Purpose

Build and maintain CEMMS, a multi-tenant coffee-estate operations platform. The product covers attendance, harvest weigh-in/muster, intake, configurable processing, packing, traceability, and reporting, with offline-first field capture.

## Source of truth

- Follow `CEMMS-IMPLEMENTATION-PROMPT.md` for product scope, phased acceptance, security, sync, and unresolved decisions.
- The architecture document's 27 October 2026 Cloudflare revision overrides older platform choices. Business process remains subject to the estate-owner confirmation record.
- The POC at `https://smkrmuthu.github.io/estate-demo/` is a UX reference only. Do not copy its simulated data, defaults, or local-only behavior as business truth.
- Checked answers and written comments in the owner confirmation are confirmed; blank answers are unresolved. Record decisions with source, approver and date in `docs/decisions/` and `docs/owner-confirmations.md`.
- Never convert an unconfirmed proposal or sample into production behavior. Gate unresolved behavior behind tenant configuration/feature flags, mark it clearly, and keep it disabled where a wrong assumption could affect operations, pay, quality, privacy, or data integrity.

## Required stack

- TypeScript modular monolith; Hono on Cloudflare Workers; shared Zod schemas; REST JSON and OpenAPI 3.1.
- Cloudflare D1 control database for tenant registry, identity, sessions and devices.
- One SQLite-backed Durable Object database per tenant, resolved at runtime from a verified token and tenant registry. Keep `tenant_id`/`estate_id` on business rows as defense in depth.
- Drizzle ORM; versioned SQL migrations for D1 and tenant DBs.
- React + Vite PWA for portal and supervisor phone use; Tailwind, shadcn/ui, TanStack Query/Table; Dexie/IndexedDB for offline drafts and durable outbox. Native Expo is deferred.
- Cloudflare Queues, Cron, R2, KV (short-lived non-authoritative cache), WAF and rate limiting.
- Glazebrooke production `glazebrooke.oneuptech.co`; staging `glazebrooke-staging.oneuptech.co` (owner decision, 28 October 2026; ADR-0010). Each tenant has its own address mapped in `tenant_domains`. Only create/use new `cemms-*` resources. Leave older `estate` and `estate-demo` Workers and databases untouched.
- Asia-Pacific placement is not India-only residency. Do not claim otherwise; a PostgreSQL-in-India/Hyperdrive path requires explicit approval and design.

Do not introduce NestJS, AWS, Redis, PostgreSQL row-level security, Expo, or SQLite on the phone unless an approved architecture decision supersedes this file.

## Architecture and code organization

- Keep strict domain modules and route → service/use case → repository boundaries. Put domain rules in testable services, not UI components or route handlers.
- Use shared schemas and generated typed clients where practical. Validate input at boundaries and revalidate invariants server-side.
- Prefer UUIDv7 IDs (including offline-created records), explicit state machines, decimal-safe/integer weight math, and transactionally allocated human-readable codes.
- Model routes/stages as versioned configuration. Preserve quantity-bearing lineage across muster → intake → batch/stage → packed lot/unit. Derived trace snapshots must be rebuildable.
- Use append-only correction/reversal records for submitted operational data. Every correction, approval, override, hold, split, merge and void needs actor, timestamp, reason and audit trail.
- Use a transactional outbox for important domain events. Queue consumers must be idempotent.

## Tenant security and privacy

- Tenant authority comes only from a verified token and validated registry lookup, never from caller-supplied tenant IDs. Fail closed on missing/mismatched tenant or estate scope.
- Enforce permissions in middleware, services and repository/data access. A request may open only its authenticated tenant's DB. Never share a tenant DB handle across requests without immutable scope.
- Test cross-tenant access attempts on every endpoint, export, sync route and public trace route.
- Least-privilege, estate-scoped roles: Platform Admin, Owner, Estate Manager, Field Supervisor, Processing Operator, Quality Officer, Packing Operator, Auditor. Owners/admins require MFA.
- Apply the specified auth baseline: WebCrypto PBKDF2-SHA256 at 600,000 iterations as six chained rounds of 100,000 (Workers limit; ADR-0009), 15-minute access JWT, rotating refresh tokens with reuse detection, throttling/lockout, revocation, and device binding. Never store long-lived bearer tokens in IndexedDB/localStorage. Supervisor offline-session length is unconfirmed and must be configurable/gated.
- TLS 1.2+, managed secrets, strict CORS/CSP, safe cookies/CSRF controls, input/output validation, abuse limits, dependency scanning, OWASP ASVS Level 2 target.
- Public QR is strict allowlist data and must never expose worker names or personal data. Logs must redact credentials, tokens and worker PII.

## Offline and sync rules

- Persist local record and outbox mutation atomically before acknowledging local save.
- Every mutation has stable ID, device ID, scope, schema version, captured time and payload/version metadata. Server deduplication is mandatory; duplicate retry returns the prior acknowledgement.
- Apply each mutation and outbox event transactionally. Return per-item accepted/rejected/conflict results; support partial batch outcomes.
- Keep queued, accepted, rejected and conflicting data visibly distinct. Reports must not count unsynced device data as server-confirmed.
- Use bounded batches, retries with jitter, and explicit conflict resolution. Never silently discard/rewrite conflicting attendance or weigh-ins.
- Handle app restart, intermittent connectivity, stale references, lost acknowledgements, clock skew, session expiry and iOS Safari without Background Sync. Sync on open/focus and manual request where needed.

## Business scope and phase boundaries

- Phase 1A target is **1 November 2026** for Admin/Supervisor sign-in, estates/fields/crops/workers, CSV master import, Attendance, Coffee/Pepper weigh-in, configurable Daily log, offline PWA sync, audit and daily summary. This near-term date and requirements must be validated with stakeholders before deployment; never weaken safeguards to claim readiness.
- Phase 1B: washing/sorting; configurable coffee Routes A/B/C; pepper light-open-dry route; batch logs/measurements/split/merge/quality; packing, labels, traceability, reports.
- Phase 2: coffee roasting/delivery and pepper packing/delivery. Payroll, billing, inventory, native app and sensors remain deferred unless explicitly approved.
- Coffee routes: A pulping then floor/tray drying; B fermentation then tray drying; C natural whole-cherry tray drying. Pepper uses coffee fields and the same weigh-in capture, then open drying for a configured number of days with no moisture target; varieties remain unresolved.
- Coffee process choice, fermentation recipe details, drying targets, tolerance values, resource rules, bag weights/labels, approval authorities, duplicate attendance policy and report definitions remain owner-confirmation gates unless explicitly answered in the source documents.
- The 16–18 week plan is an estimate, not a commitment. Keep Phase 1A target separate from full Phase 1B delivery.

## Engineering workflow

1. Inspect the repository and all `AGENTS.md`, package scripts and deployment bindings before editing. Preserve existing user work and follow local instructions.
2. For each task, identify the smallest coherent vertical slice and update `docs/implementation-status.md`, owner-decision register, and relevant design/API docs.
3. Add/update tests alongside implementation: domain unit tests, Workers-runtime integration, tenant isolation, offline sync, migration, and relevant browser E2E/acceptance tests.
4. Before completion, run appropriate lint, typecheck, tests, build and migration checks. Report exact checks and failures; do not claim unrun checks passed.
5. Review diffs for tenant scope, authz, audit coverage, PII leakage, decimal correctness, idempotency, migration safety, secret exposure and changes to legacy estate resources.
6. Check current official Cloudflare/library documentation when using provider APIs whose limits or behavior may have changed. Record material constraints and decisions.

## Migrations, CI/CD and operations

- Version migrations in source control. Tenant DB provisioning/migration is runtime-safe and observable; use migration locks/version state, bounded resumable steps, backward-compatible expand/backfill/contract, and recovery steps.
- Local and staging use synthetic/test data only. Staging cannot bind to production DBs, queues, buckets, secrets or real worker data.
- CI requires formatting/lint, types, tests, OpenAPI diff, module boundary checks, migration validation, isolation suite, dependency/security scan and build. Do not deploy production from PR automation.
- Staging deployment and UAT precede production. Production requires manual approval, health checks, migration readiness, backup/restore plan, canary/rollout plan and rollback that preserves new writes.
- Do not run production migrations/deploy, change secrets/domains, perform destructive operations, or mutate legacy `estate*` resources without explicit authorization at the time.
- Log structured request IDs and scoped tenant/user/estate IDs; redact PII and tokens. Monitor API health, sync outcomes, queue/outbox lag, migration state, export/label failures, backups and tenant DB sizes. Treat 99.5% availability and p95 <500ms as proposed targets, not committed SLAs.

## UX and accessibility

- Use the POC's warm, coffee-inspired visual language, clear portal navigation, phone-first roll call/muster, and visible offline/sync indicators as inspiration only.
- Prioritize fast field entry, large touch targets, keypad-friendly weights, low-bandwidth use, keyboard navigation, contrast, semantic labels and understandable errors.
- Make offline/pending/conflict state unmistakable. Do not visually imply server acceptance before acknowledgement.
- Do not expose engineering details or unresolved sample values in operator-facing copy; explain operational consequences in plain language.

## Completion standard

A change is complete only when implementation, tests, schema/migrations, docs, error states, authorization, audit, observability, and acceptance criteria are aligned. Keep TODOs actionable with the exact owner decision, affected behavior, and whether it blocks release. Never state an owner question is resolved by inference. At handoff, state delivered scope, verified checks, open decisions, limitations, and the next safe action.
