# CEMMS Implementation Prompt

Source: supplied by the project owner on 28 October 2026. This file is the implementation brief that `CLAUDE.md` refers to.

## Mission

Build CEMMS (Coffee Estate Management and Operations System), a secure, multi-tenant estate operations platform from a clean repository. The product covers daily attendance, crop weigh-in/muster, intake and washing, configurable coffee processing, packing, traceability, and operational reporting. It must work for field supervisors with intermittent connectivity and provide an owner/manager portal.

Do not stop at a design, scaffold, or attractive demo. Implement working vertical slices, migrations, API, PWA, tests, CI, and deployment configuration in staged increments. Keep the repository runnable after every phase. Before coding, inspect the repository, existing instructions, and current state. Preserve useful work. If a repository or deployment already exists, assess it and report what is present before changing it.

## Authoritative inputs and precedence

Use these supplied documents as business and technical inputs:

1. **CEMMS MVP Architecture and Technical Design (Attendance to Packing), revision 27 October 2026**. The Cloudflare platform and phased go-live revision at the beginning takes precedence over older sections. Business process and offline-sync design remain applicable.
2. **Coffee Estate Application - Process Confirmation for Estate Owner**, dated 23 October 2026. Treat checked answers and written comments as confirmed; blank boxes or unanswered fields are open questions, not answers.
3. POC: `https://smkrmuthu.github.io/estate-demo/`. It is a UX/layout reference only, never the source of truth for business rules or sample defaults.

When source documents conflict, use the revised Cloudflare architecture for technology. Use explicit owner-confirmed facts for business behavior. If a behavior is not confirmed, preserve it as configurable/TODO and do not silently turn an architecture document's illustrative default or POC sample value into estate policy. Record the source and status of each decision in `docs/decisions/` and `docs/owner-confirmations.md`.

## Product and business scope

### Tenancy and estates

- Multi-tenant SaaS, with multiple estates per tenant and role grants scoped to estates.
- The first named estates are Glazebrooke and Byson Valley. They are examples/first-tenant context, not hard-coded platform limits.
- Coffee and pepper may grow in the same fields. Crop is selected on each weigh-in; carry crop through muster, intake, lineage, and reports. Pepper is confirmed as using the same fields and weigh-in pattern as coffee.
- Pepper processing is a short route: weigh-in followed by light open drying for a configured number of days, with no moisture target. Pepper packing and delivery are Phase 2. Pepper varieties are still unconfirmed.
- Tenant feature flags/configuration determine which crop-specific screens and stages appear.

### Attendance

- Daily attendance register by estate/date and worker, with presence/status, full or half day where applicable, field, job, supervisor, and remarks.
- Phone/PWA field capture works offline. The portal supports review and approval.
- Support bulk status and field/job assignment, prior-day values as a starting point, worker search, and monthly views.
- Preserve submit/approve/correction history. Corrections after submission require reason and actor; never silently overwrite.
- The owner confirmation describes Present/Absent and full/half day; it lists Leave/Off day/Holiday as proposed types but does not confirm that list. Make status vocabulary configurable until confirmed.
- Whether workers may change fields/jobs during the day, fixed gangs, approval owner, arrival/departure times, wage calculations, worker counts, and historical-entry window are open confirmation items.

### Daily log

- Phase 1A includes a daily log and the owner-confirmation material describes temperature and rain readings twice per day for both estates from one place per estate. However, exact readings, locations, cadence, units, and responsible users remain unconfirmed. Implement a configurable log type/measurement framework and keep these values as seedable configuration with a prominent TODO; do not treat the sample as finalized policy.

### Weigh-in / plucking muster

- Capture separate worker weigh-ins, including multiple weigh-ins per worker/day if enabled by confirmed configuration; preserve date, worker, estate, field/division, optional subdivision, crop, variety where applicable, gross, bag/basket count and tare, net kg, remarks, and capturing user/device.
- Compute net from validated components in a shared domain function. Use decimal-safe arithmetic and explicit units/precision. Never trust client-calculated net without server revalidation.
- Offline-created IDs remain stable after sync. A supervisor can see local queued, accepted, rejected, and conflict states.
- The design lists per-worker, kg, multiple entries, gross/tare optional as proposed defaults, but several corresponding owner questions are blank. Keep configurable and block production activation of unconfirmed units/tare/duplicate policy.
- Pepper uses the same weigh-in flow and fields as coffee (explicitly answered yes in the owner confirmation).

### Intake, washing, and sorting (Phase 1B)

- Create intake lots from submitted muster allocations; record received, floaters, rejects, accepted quantities and lot code.
- Reconcile muster versus received and accepted weight. Require a reason when variance exceeds the configured tolerance; the architecture's sample 1% is not an owner-confirmed value.
- Support allocations and explicit kilogram links. Do not lose original muster-to-intake genealogy when lots combine or split.
- Whether washing timing, varieties separated, cross-day combining, and exact lot composition rules are open questions/configuration.

### Processing engine (Phase 1B)

Use versioned, data-driven route templates and stage definitions. Do not hard-code route assumptions into screens or database schema.

- **Route A:** washing/sorting → pulping → floor drying or tray drying → checks/quality approval → packing.
- **Route B:** washing/sorting → fermentation → tray drying → checks/quality approval → packing.
- **Route C:** selected whole cherries → natural tray drying (no pulping) → checks/quality approval → packing.
- Capture stage starts/completions, responsible operator, resource (tank/floor/tray), quantities before/after, measurements, readings, notes, turning/covering/rain events, holds, rework, and quality decisions as configured.
- Support batch split and merge with explicit source/target relations and kilogram quantities. Record tank/tray/floor allocations as quantity links; a resource may hold multiple harvest dates/subdivisions if allowed by configured policy.
- Fermentation recipes/flavours are master data with configurable attributes. The names/codes GBF1/Pineapple, GBF2/Avocado, GBT1/Apple are examples from an unconfirmed flow; do not assume ingredients are added or infer timing. Mixed-flavour percentage totals must validate to 100% if that feature is enabled. Time calculation (weighted average versus manual choice) is a TODO gate.
- Pulped coffee may rest before drying, but two days and resting location are unconfirmed. Model a configurable rest stage; do not seed an active production duration until confirmed.
- Drying duration, final moisture targets, measurement frequency, resources, checks, photo policy, who approves, rework rules, and out-of-order overrides are configuration gates. Architecture defaults such as 14 days, final moisture required, and quality-officer approval are proposals, not signed estate answers.
- Managers with explicit permission may perform stage overrides; every override requires a reason and audit event.

### Packing and traceability (Phase 1B)

- Pack approved batches into packed lots and optional per-bag/pack units. Record product type, route, batch sources, date, package type, bag count, target/actual weights, lot code, and label artifact.
- Maintain exact lineage from each packed lot and each pack unit backward through batches, stage runs, intake allocations, muster entries, harvest date, worker, field/subdivision and variety/crop, with quantities. The architecture allows multiple batches/dates in one lot and per-bag source allocation; preserve these links even if display policy is unresolved.
- Internal authorized trace view may show worker details. Public QR trace must never expose worker names or personal data; disclose only approved minimum fields and allow tenant configuration/publication control.
- The architecture proposes lot-level labels, optional per-bag labels, A4/4x6 PDF, and up to three harvest dates before range display. Owner answers about label unit, printer, code format, package weights, underweight tolerance, and date display are open; make these configurable and gate label/publication defaults on approval.
- Phase 1 ends at dried parchment or dried cherry. Hulling, grading, roasting, small consumer packs, stock, sales, and delivery are out of Phase 1; coffee roasting/delivery and pepper pack/delivery are Phase 2.

### Reporting

Phase 1A daily summary must distinguish server-accepted records from device-pending entries; do not claim complete data before sync. Phase 1B reporting should include attendance by field/job, harvest by worker/field/crop/variety/date, intake and variances, processing WIP/drying, packed quantities, genealogy, and CSV/XLSX export with role-based privacy controls. Outturn denominator, productivity/pay preview, messaging destination/time, and other report definitions are unresolved; keep disabled or clearly marked provisional until confirmed.

## UX reference: POC

Inspect the POC before finalizing UI where available. It presents a warm coffee-inspired visual system, desktop portal navigation/work column, a phone-style supervisor view, attendance roll-call, muster entry, signal/offline simulation, daily log, processing board, batch actions, packing/labels, trace lookup, and report views. Borrow its useful information hierarchy and mobile-first operational shortcuts, but replace simulated/local-only persistence with real APIs, authorization, durable offline queue, visible sync states, and the confirmed business rules above. Rework any POC choices that conflict with accessibility, security, or owner-confirmed workflows.

## Required architecture (Cloudflare only)

Implement a TypeScript modular monolith, designed so module boundaries are clear and services are not prematurely split.

- **API:** Hono on Cloudflare Workers. Organize by domain module with route → service/use case → repository layers; validate request/response with shared Zod schemas; provide REST JSON API and OpenAPI 3.1.
- **Control plane:** Cloudflare D1 stores tenants/registry, users, credentials, sessions, devices, and control metadata.
- **Tenant data:** one SQLite-backed Durable Object per tenant, created/opened at runtime by stable tenant identity. Each request may access only the tenant DB resolved from a verified token and validated registry entry. Keep `tenant_id` and `estate_id` on domain rows as defense in depth and for portability.
- **Persistence:** Drizzle ORM for D1 and tenant SQLite; version-controlled SQL migrations. Tenant migrations must run safely and observably at startup/onboarding with a lock/version check and rollback/forward-recovery plan. New tenant provisioning must not require a Worker redeploy.
- **Web/PWA:** React + Vite, Tailwind, shadcn/ui, TanStack Query/Table; one installable PWA for portal and supervisor workflows; service worker app shell and IndexedDB (Dexie) for reference data, drafts, and durable mutation outbox. The native Expo app is deferred.
- **Async/files:** Cloudflare Queues and Cron Triggers for transactional outbox delivery, label/export generation, notifications and nightly backup; R2 for photos, labels, exports and encrypted nightly tenant DB copies; KV only for short-lived non-authoritative cache. Use rate-limiting bindings and WAF rules.
- **Environments/domains:** production `estate.oneuptech.co`; staging `estate-staging.oneuptech.co`. Use separately named `cemms-*` resources, bindings, secrets, queues and buckets. Do not modify, bind to, migrate, delete, or otherwise disturb older `estate` and `estate-demo` Workers/databases. Use Asia-Pacific location hints; do not claim India-only residency. India-only tenants require a separately approved PostgreSQL-in-India option through Hyperdrive, not an implicit fallback.
- **Hosting:** Cloudflare account only for application runtime. No NestJS, AWS, Redis, PostgreSQL row-level security, Expo, or mobile SQLite implementation in this revision.

Before implementing provider-specific limits or APIs, check current official Cloudflare documentation and installed package documentation. Do not assume a capability exists merely because this architecture names it; record verified binding limits/constraints and design around them.

## Security, privacy, correctness

- Threat-model tenant onboarding, authentication, public QR, support access, CSV import/export, offline devices, and signed/sync payloads.
- Enforce tenant and estate scope in auth middleware, service authorization, repository boundaries and DB selection. Never accept tenant identity from a body/query parameter as authority. Fail closed on missing or mismatched scope. Platform support access requires a time-bounded, audited grant and must not be a standing bypass.
- Implement least-privilege role/permission checks for Platform Admin, Owner, Estate Manager, Field Supervisor, Processing Operator, Quality Officer, Packing Operator, and Auditor. Map to the roles/permission table in the architecture and keep grants estate-scoped. MFA required for owners/admins.
- Auth design from the revision: WebCrypto PBKDF2-SHA256 with 600,000 iterations, 15-minute access JWT, rotating refresh tokens with reuse detection, login throttling/lockout, session revocation, device binding. Supervisor offline session duration (up to seven days in a question) is unconfirmed: configurable, secure, and blocked pending approval. Do not store long-lived bearer credentials in IndexedDB/localStorage; minimize offline token exposure and document browser/PWA limits.
- TLS 1.2+, managed secrets, secure cookies where applicable, CSRF protections where cookie auth is used, strict CORS, CSP, input validation, output encoding, safe file handling, abuse limits, dependency scanning. Target OWASP ASVS Level 2.
- Audit all create/update/submit/approve/correct/reopen/override/reverse/void and permission-sensitive actions. Store actor, tenant, estate, timestamp, request/device/mutation identifiers, reason, and before/after snapshots or safe diffs. No destructive editing of submitted operational records; corrections are append-only and traceable.
- Use decimal/integer minor units for weights and percentages (no binary-float business arithmetic); enforce non-negative quantities, allocation caps, and explicit unit conversions.
- Public trace endpoints return a strict allowlist and cannot be used as a tenant enumeration oracle.
- Logs/metrics must omit passwords, token material, worker PII and sensitive payloads. Define retention/deletion and backup restore procedures; document residency as Asia-Pacific placement, not India guarantee.

## Offline sync contract (must be robust)

1. Every client mutation has stable UUIDv7 `mutationId`, entity ID, device ID, schema version, tenant/estate scope, captured-at timestamp, and payload hash/version.
2. Persist mutation and local draft atomically in IndexedDB before showing success. Never lose queued data on reload, app restart, temporary network loss or partial response.
3. Upload in bounded batches with backoff/jitter; retry is expected. Server deduplicates on tenant/device/mutation ID and returns the original acknowledgement for duplicates. Apply each accepted mutation and its outbox event in a transaction.
4. Return per-mutation accepted/rejected/conflict status, canonical entity version, server timestamp and actionable validation errors. Do not mark an entire batch successful when only some mutations committed.
5. Attendance duplicate/conflict rule is unconfirmed; do not silently pick a winner. Provide conflict queue and authorized manager resolution with a reason and retained alternatives. Question 103 proposes manager choice when two supervisors record the same worker/day; pending confirmation.
6. Use optimistic version/ETag checks for edits, with explicit conflict workflows. Distinguish locally queued from server-committed records in every dashboard/report.
7. Provide a sync health screen: last sync, pending count, rejected count, conflicts, retry action, and per-item detail. iOS Safari may lack Background Sync; sync on app open, visibility/focus, and explicit user action. Do not promise background sync where unsupported.
8. Test duplicate uploads, partial failures, stale references, device clock skew, app termination/restart, lost acknowledgements, two devices, and authorization/session expiry.

## Data and domain design expectations

Establish module boundaries and an ERD before broad implementation. Expected domains/entities include:

- Control: Tenant, TenantFeature, User, Session, RefreshToken, Device, Role/Permission, UserEstateRole, provisioning/migration status.
- Organization: Estate, Field/Division, optional Subdivision, Season, CropEstimate, Crop, Variety, JobType, WorkGroup, Resource, ReasonCode, Setting, CustomFieldDefinition, PackagingType, Product and configurable recipe/stage definitions.
- Operations: AttendanceSheet/Record/Assignment, MusterEntry, IntakeLot/Allocation, RouteTemplate/Version/Stage/Transition, Batch/Input/Relation, StageRun, Measurement, StageLog, Approval, PackedLot/Source, PackUnit/Source.
- Cross-cutting: AuditLog, SyncMutation/acknowledgement, OutboxEvent, File, Notification, ExportJob, TraceSnapshot/read model.

Prefer UUIDv7 IDs generated offline or server side; human-readable sequence codes are tenant/estate scoped, transactionally allocated, and concurrency tested. Add appropriate unique constraints and indexes. Use explicit state machines and invariant enforcement in domain services/database constraints where possible. Keep traceability as normalized quantity-bearing relations; derived snapshots are rebuildable read models, never the only lineage record.

## Phased delivery and acceptance

Work in small, reviewable vertical slices. At the start of each phase, restate scope and prerequisites; update `docs/implementation-status.md` and a decision log. Do not claim a phase is complete while its acceptance criteria or security gates fail.

### Phase 0: discovery and foundation

- Inventory repository, environment and Cloudflare resources read-only. Confirm no legacy resource mutation.
- Resolve schema/technology blocking questions where required; Cloudflare choices are confirmed by the 27 October revision. Create ERD, domain glossary, OpenAPI baseline, security/threat model, data classification, decision register, unresolved owner questionnaire, resource naming map, and rollout/rollback plan.
- Set up monorepo/workspaces, lint/typecheck/unit/integration/e2e commands, CI, local Wrangler/Miniflare bindings, dev/staging/prod configuration, secret handling, migrations, design system shell, and safe seeded demo fixtures. Do not put real worker data or credentials in fixtures.

### Phase 1A: intended first live slice

The architecture states **go-live target: 1 November 2026** for Admin and Supervisor sign-in, estate/field/crop/worker masters, CSV master import, Attendance, Weigh-in (plucking muster), Daily log, installable PWA offline sync, audit log, and daily summary for Coffee and Pepper.

This date is only five days after the design revision and must be explicitly validated with the owner, team, data readiness, operational acceptance, security checks, and deployment readiness before any release. Treat it as a target in planning, not authorization to deploy or evidence of feasibility. Keep production behind manual approval. If date or requirements cannot be validated, deliver an honest readiness assessment and staged plan instead of weakening security or correctness.

Phase 1A exit criteria:

- Tenant/estate scope, Admin/Supervisor RBAC and MFA expectations implemented and covered by isolation tests.
- Estate, field, crop, worker/job master data with validated CSV import, preview, row errors, idempotent re-import and audit trail.
- Attendance submit/approval/correction workflow and offline field flow with clear pending/accepted/rejected/conflict states.
- Coffee and pepper weigh-in using same capture model; server-side decimal-safe totals; duplicate idempotency; correction audit.
- Configurable Daily log; exact measurement definitions kept pending owner confirmation.
- Daily summary separates synced and pending data.
- Staging acceptance by owner/operations on representative workflows; accessibility and small-screen review; restore/rollback drill; no critical/high security findings; production release requires explicit manual gate.

### Phase 1B: operations completion

- Intake/washing/sorting and variance reconciliation.
- Configurable coffee processing engine and Routes A/B/C, pepper open-dry route, configurable fermentation/flavours, drying logs, measurements, holds/rework, split/merge, approvals.
- Packing, labels, genealogy and privacy-safe public QR page.
- Operational dashboards/exports, load/security hardening, owner acceptance. Owner-confirmation gates must be resolved/configured before enabling each affected rule.

### Phase 2 and later

Coffee roasting and delivery; pepper packing and delivery; storage/inventory, warehouse transfers, orders, dispatch, payroll, billing, SSO, native Expo app, Bluetooth scales/sensors and advanced public provenance are deferred unless separately approved and scoped.

The architecture's 16–18 week estimate is a planning estimate for the fuller MVP and is not a commitment. Reforecast with actual staffing, owner decisions and Cloudflare capability constraints. Keep the 1 November Phase 1A target distinct from the later Phase 1B plan.

## Unresolved owner confirmations: configuration/TODO gates

Create a machine-readable and human-readable register with question number, exact decision needed, source, owner, status, affected schema/UX/reports, safe interim behavior, approver and date. Use feature/configuration flags for unresolved variation. **Do not activate guessed defaults in production.** The architecture lists proposed defaults for many unanswered items; label them proposed, not confirmed.

Owner-confirmation PDF answers that are explicit include: overall daily process correct (Q1); the three current coffee routes only (Q2); no missing process step (Q3); field phone or computer/web app (Q4); worker field/job-per-day question marked N/A (Q5); fixed gangs marked N/A (Q6); pepper weigh-in same fields/flow (Q105); pepper has light open drying with set number of days and no moisture target (Q106); pepper delivery Phase 2 (Q107); coffee roasting Phase 2 (Q108). The architecture revision additionally confirms Coffee and Pepper in the same fields, crop selected per weigh-in, and pepper short route. Keep every other unfilled checkbox/blank as unconfirmed.

At minimum track these open questions from the owner-confirmation PDF:

- Q7–11: attendance approval owner; status vocabulary; arrival/departure times; wage/pay calculation; normal/peak worker counts.
- Q12–15: field/division labels; mixed varieties; exact variety list and YMG meaning; worker master list/import readiness.
- Q16–22: separate/multiple weigh-ins; units; tare/bag deductions; scale make/model; cherry-quality capture; who weighs.
- Q23–27: muster-to-washing reconciliation; washing timing; whether varieties stay separate; whether harvest days may combine; recording floater/reject weights.
- Q28–49: process chooser; batch split/merge/mix rules; pulping details; fermentation paths/tanks/methods/flavours/additives/readings/duration; natural selection; drying durations/moisture/frequency/resources/checks/approver/rework/photos.
- Q50–60: packed product, package standard, label scope/printer, lot mixing and partial packing, numbering, packing end-state; reports; public QR; summary channel/recipients/time.
- Q61–67: field and yard connectivity; device availability; languages; estates under one login; later-phase acceptance and any feature pulled into first release.
- Q68–86: shared processing facilities; subdivision meaning/list/ownership/separation; acreage and variety discrepancies (including Orange Kadu, No. 49, Chandana Giri/Chandragiri); elevations; season; fermentation code meaning; "Wats"; tank/tray mixing; item code; hulling/grading and consumer packs; weight capture points; multi-date bag label style; worker home field; master-data owner; back-entry window.
- Q87–103: empty-bag tare (POC sample 0.5 kg is not confirmed); muster/wash tolerance (1% sample not confirmed); tray capacity (80 kg sample not confirmed); holds/splits; underweight tolerance (100 g/5 g samples not confirmed); outturn basis; piece rate; summary recipients/time; mixed flavour timing and recipe authority; pulped rest duration/location (2-day sample not confirmed); gender-related task/rate use (do not collect/use without a confirmed need); weather readings/location; offline session duration; pending-sync reporting behavior; duplicate attendance resolution.
- Q104: which fields/estates grow pepper is answered "same fields as coffee" in the owner PDF comments; reconcile this with the architecture's same-fields note and record as confirmed.
- Q105–108: Q105, Q106, Q107, Q108 have explicit answers noted above; Q105 check the answer text even though the Yes/No box appears checked ambiguously. Do not infer pepper varietal tracking or pack sizes from them.

Architecture Open Questions (end of design document) are also tracked by number. Mark confirmed technology items Q2–3 per 27 October revision. Treat tenant/company/login model Q1, weigh-in policy Q4, attendance/workgroup model Q5, batch mixing/split/merge Q6, and first-tenant processing/subdivision questions Q23–25 and hulling/packing boundary Q30 as blocking for the affected schema/workflows until confirmed or a documented owner-approved model is agreed. Do not copy the design's proposed defaults for unresolved business choices into live tenant configuration. If a limited Phase 1A slice can be built without them, isolate the gated behavior rather than block unrelated foundations.

## Quality, tests, CI/CD and operations

Add tests as part of implementation (do not postpone them):

- Unit: weight and tare math, rounding, status transitions, permission policy, route graph validation, allocation conservation, drying target resolution, label date summaries.
- Integration against Workers-compatible runtime and real D1/DO SQLite adapters: use cases, migrations, transactional outbox, sequence allocation/concurrency, quantity constraints and tenant DB provisioning.
- Tenant isolation: hostile attempts to read/update another tenant through every route, export, public QR and support path; verify token tenant cannot be overridden.
- Sync: offline-first save, restart, duplicate upload, partial ack, lost response, concurrent devices, conflicts, malformed/stale payload and permission expiry.
- E2E: attendance, correction, muster, daily log, intake/routes/pack/trace, CSV import errors, responsive supervisor PWA, accessibility basics.
- Acceptance fixtures for each coffee route, pepper drying, packed lot from two batches/dates, split/merge, full trace to workers internally and no worker PII publicly.
- Keep checks fast and deterministic. Publish results and make CI required for merge.

CI for every PR: install with locked dependencies, formatting/lint, typecheck, unit/integration tests, migration validation, OpenAPI generation/diff, module-boundary checks, tenant-isolation suite, dependency/security scan, production build and preview deployment to isolated non-production resources where safe. Never run production migrations/deploy automatically from PR CI.

Deployment:

- Distinct Cloudflare accounts/resource names/bindings per environment where available; otherwise strict environment bindings and credentials. Staging must never point to production D1/DO/R2/Queues or real worker data.
- Production `estate.oneuptech.co`; staging `estate-staging.oneuptech.co`; older `estate` and `estate-demo` resources untouched.
- Migration plan is expand/backfill/contract, backward compatible with the previous Worker version, observable per tenant, resumable and bounded. Snapshot/backup before risky migration. Define restore and forward-fix steps; test restoration from R2 and DO point-in-time restore assumptions.
- Staging deploy after green CI; owner UAT; manual production approval; canary/small-tenant rollout where feasible; health checks, migration status and alarms; documented rollback that does not discard new writes.
- No actual production deploy, destructive operation, domain cutover, secret change, or legacy-resource mutation without explicit user/operator authorization at that point.

Observability:

- Structured JSON logs with request/correlation ID and scoped tenant/user/estate identifiers, with PII/token redaction.
- Metrics/traces for latency/error rate, sync accepted/rejected/conflict rate, queue depth/age, outbox lag, migration status, job duration, label/export failures, backup age/restore drills, and tenant DB size.
- Alerts for elevated sync rejection, outbox backlog, failed backups/labels/exports, auth abuse, migration failures and service health. The proposed 99.5% monthly availability and p95 under 500ms are targets to validate, not silently promised SLAs.

## Working method and final handoff

1. Read repo instructions and inspect current state. Summarize findings and assumptions in `docs/implementation-status.md`.
2. Build the decision/configuration gate register and ERD/API contract before locking schema. Keep unresolved answers visible to the owner.
3. Implement one phase at a time; keep code, migrations, tests, docs, and run instructions in sync. Use current official docs for changing Cloudflare APIs and libraries.
4. After each slice, run the relevant checks, review the diff for secrets, PII, tenant-scope gaps, migration hazards and unintended legacy-resource changes.
5. Keep TODOs actionable with owner, blocking status, and affected behavior. Never mark an owner question answered by inference.
6. At handoff, report: delivered scope; exact commands/check results; outstanding owner decisions; known security/operational limitations; phase/date feasibility; staging and production resource names; and next safe action. Do not report deployment as complete unless verified in Cloudflare and the expected domain/version is actually live.
