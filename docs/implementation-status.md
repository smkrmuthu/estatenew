# Implementation Status

Last updated: 28 October 2026 (staging deployed).

## Starting point (Phase 0 inventory)

- Repository: prototype (`prototype/index.html`), README, owner and architecture PDFs (now git-ignored like the .docx/.xlsx), `CLAUDE.md`. No application code before today.
- Cloudflare account (read-only check on 27 October): existing `estate`, `estate-demo`, fleet Workers, D1 databases `estate-db`, `estate-demo-db` and others, two R2 buckets for another product, no Hyperdrive. None of these are used or changed. No `cemms-*` resources exist yet.
- Toolchain: Node 24, npm 11, Wrangler 4.154. pnpm not installed, so npm workspaces are used.
- Platform facts checked in current Cloudflare docs are recorded in `docs/decisions/0001-cloudflare-platform.md`.

## Delivered (all in this repository, not deployed)

| Area | What works | Tests |
|---|---|---|
| Domain package | Weights in integer grams (parse, tare modes, net), attendance statuses and sheet state machine, estate-scoped permissions for all 8 roles, MFA roles, settings with owner gates (production refuses unconfirmed values), Daily log readings, CSV parsing and master import specs, sync contract, UUIDv7, business dates | 45 unit tests |
| Contracts | Zod schemas for every request and sync payload | 4 tests |
| Control plane (D1) | Tenant registry, users, estate grants, devices, sessions, refresh tokens, platform audit; versioned SQL migration | Exercised by the API tests |
| Tenant database | One SQLite Durable Object per tenant; runtime migrations with checksum and lock; tenant binding and mismatch refusal; operation dispatcher with input schemas; transactional audit, revisions and outbox; outbox delivery to Queues through alarms; nightly encrypted snapshot to R2 (cron) | `isolation.test.ts` |
| Auth | Sign-in with lockout and rate limits, TOTP enrolment and verification for Owner/Manager/Platform Admin, 15-minute JWT in memory, rotating httpOnly refresh cookie with reuse detection, CSRF header, logout, password change, user creation and disabling | `auth.test.ts` (8 tests) |
| Masters | Estates, fields (crops and varieties), varieties, job types, workers, Daily log kinds; CSV preview with row errors, all-or-nothing apply, idempotent re-import, formula-injection guard, no gender column | `admin.test.ts` |
| Attendance | Per-worker records from phones (offline), Present/Absent with Full/Half day (other types inactive until OC-8), field and job required when present, prefill from previous day, submit, approve, send back with reason, corrections with reason and full history, duplicate and stale entries become conflicts that a manager resolves with a reason | `attendance.test.ts` (6 tests) |
| Weigh-in | Coffee and pepper with the same capture; crop must be grown in the field; optional variety checked against crop and field; server recomputes net; cancel own entry with reason; manager correction with reason; several entries per worker kept and flagged | `muster-dailylog.test.ts` |
| Daily log | Configurable kinds (no readings hard-coded), range and decimal checks, correction with reason | `muster-dailylog.test.ts` |
| Sync | Per-item accepted/rejected/conflict results, stored acknowledgements for retries, payload hash check, mutation id reuse refused, device binding, clock-ahead and too-old refusal, batch limit 100, device waiting counts | `sync.test.ts` (4 tests) |
| Dashboard | `GET /estates/:id/reports/dashboard/:date`: today's roll call, 14 days of accepted weigh-ins, items awaiting approval, open conflicts and entries still on phones; estate-scoped, in the cross-tenant isolation list | `muster-dailylog.test.ts`, `isolation.test.ts` |
| Daily summary | Server-accepted counts only, with devices' waiting counts and open conflicts shown separately | Covered in several suites |
| Readiness | `GET /admin/readiness` lists open owner questions that block Phase 1A; first tenant can be seeded with the owner's recorded answers | `admin.test.ts` |
| Web app (PWA) | Portal layout like the prototype: left sidebar with icons on desktop and an icon bar on phones, top bar with online/waiting state, clock, user and role; Dashboard (workers today, coffee and pepper weighed today, daily log count, needs-attention list, 14-day chart; server-accepted data only, no season total or targets until the season start and expected crop are confirmed). Sign-in with MFA, estate and day picker with previous/next, roll call (fill from previous day, submit, approve/send back), weigh-in with live net, Daily log, Sync screen (waiting/not accepted/conflict, retry, remove), Summary, Manage (CSV import, users, conflicts, Daily log kinds, readiness), installable with service worker app shell, IndexedDB outbox written atomically, auto-sync on open/focus/online/every minute, error screen | 3 outbox/sync tests; checked by hand in a phone-size browser, including an API outage and a reload while entries were waiting |
| Tooling | Biome lint/format, module boundary check, register render check, OpenAPI 3.1 generated from the route registry and pinned in `docs/api/openapi.json`, CI workflow (checks on every PR; staging deploy on main; production only by manual approval) | `npm run check` |

## Checks run on 28 October 2026

`npm run check` passed: Biome (107 files), module boundaries, owner register render, TypeScript in all four packages, 83 tests (45 domain, 4 contracts, 31 API in workerd, 3 web), web build, Worker dry-run build. `npm audit --audit-level=high` passed; 4 low-severity advisories remain in the PWA build tooling (`deepmerge` via `workbox-build`), build time only.

Not run: browser end-to-end suite (Playwright), load test, OWASP ZAP scan, staging restore drill. These need staging (see below).

## Masters and Users (28 October, interim: ADR-0011)

Masters has Fields, Workers, Jobs and Log kinds tabs with Add and Edit side forms like the prototype; Users is its own page with last sign-in. New optional data: worker gender, area (where from) and type (Permanent, Casual, Contract, North Indian), field elevation, expected cherry and subdivisions, job "counts as plucking", log kind "expected per day". Server allocates employee codes (`GLZ-001`) and field codes (`GLZ-01`). Tenant migration 0002 adds the columns and table; 0003 adds worker area and the North Indian type; 0004 and 0006 let a worker be allotted to the estates chosen for them (ADR-0013): Masters has one worker list and an estate tick list per worker; the worker shows in each of those estates' register and plucking list, but cannot be present in two estates in the same shift of one day. Gender, when entered, shows as a tag beside the worker's name in the register. Filters (only change what is listed, never what is saved): Attendance (worker status, area, gender, today's mark, field), Masters workers (estate, type, area, gender, status) and fields (estate, crop, variety, status), Users (role, estate, status), Plucking day list (field, crop, state) and Reports plucking (estate, field, crop, worker). Each shows how many are listed and has Clear filters. Reports → Excel files downloads the old-format daily sheets (one sheet per date, same layout as the estate's sheet, marked old format) and a new-format backup workbook for a date range (ADR-0015). 0005 adds a Day and a Night attendance register (ADR-0014) for workers who work a field job by day and night watch by night; each register is submitted and approved on its own. Workers and fields that no attendance or weigh-in record refers to can be deleted from Masters (tick rows, Delete selected, a reason is required and audited; used ones are refused and should be set Inactive). Importing a CSV never deletes; it adds or updates by code, and a field that has subdivisions keeps its varieties and acres. Not yet: no CSV import for subdivisions; gender, subdivisions, elevation and expected crop wait on owner answers (OC-99, AQ-24, OC-74, OC-75).

## Prototype gaps closed (28 October)

- **All estates:** the Dashboard and Reports can show every estate together (the estate picker has "All estates"); capture screens still work on one estate.
- **Attendance:** per-worker History, and a manager's Correct form on submitted or approved days (append-only correction with reason, through the existing correction API). "Workers by field" was already there.
- **Daily log:** readings over 7 or 30 days as a chart and a list, and "Rain 1 of 2" progress against each kind's expected readings per day.
- **Reports:** "Copy for WhatsApp" daily message, and a date-range report of weigh-ins by field and by worker (weights only, no pay; worker detail needs `reports.workerDetail`).
- **Dashboard and sidebar:** season total against expected cherry (needs the season start setting, OC-75), and a badge on Attendance for days waiting for approval.
- **Plucking:** a "By subdivision" table (letter only where unambiguous; subdivision weighing still open, AQ-25).
- **Attendance approval (29 October, ADR-0017):** a manager's or owner's own submit approves the Day or Night register straight away (both steps audited); a supervisor's submit still waits for a manager. Held back while conflicting entries are open. OC-7 is still open with the owner.
- **Plucking page laid out like the prototype (29 October):** the worker is chosen from a list of the workers marked present in the day register on a job that "counts as plucking" (a tick shows who is already weighed; other workers are listed below them), the field comes from this morning's attendance, and **Save and next worker** moves to the next plucker with no weigh-in. The cards read Net cherry, Weigh-ins, Pluckers weighed (of those marked present for plucking) and Per plucker. A **Muster and washing** table beside By subdivision lists the last 10 days with weigh-ins (`GET /estates/:estateId/muster-days/:date`, counts and totals only, no worker names, accepted weigh-ins only). The Washed column stays empty because washing is Phase 1B. Not copied: the prototype's "Each bag (kg)" box, because the empty-bag weight is still unconfirmed (OC-87), so tare stays a typed total; and its "Submit for washing" step. If no job type is ticked "counts as plucking" in Masters → Jobs, the list falls back to every worker with a note saying so.
- **Masters:** Plucked and Progress columns on fields once the season start is set.
- **Estate manager access (28 October, project lead instruction):** an estate manager on any estate (including one with a separate grant for each estate) can add and change the lists every estate shares (Daily log kinds, jobs, varieties), change settings such as the season start and attendance types (`settings.configure`), and manage users. Guards: only an owner can give or change the Owner role; a manager can only give access to estates they manage; no one edits their own access. Recording go-live answers and the readiness list (`settings.manage`) stay with the owner.
- **Users:** edit a person's name, role and estates (their sessions end; the last owner and your own access cannot be changed) and re-enable a disabled user.

## Prototype pages not built yet

Washing, Processing, Packing, Trace a bag and Process settings from the prototype are Phase 1B and are not in the menu. Plucking is the Weigh-in page (it also covers pepper). Masters and Users are inside Manage. Daily log "expected readings per day" is not shown because the reading list is open (OC-100).

## Phase 1A exit criteria

| Criterion | Status |
|---|---|
| Tenant/estate scope, Admin/Supervisor RBAC, MFA, isolation tests | Met in code and tests |
| Masters with CSV import, preview, row errors, idempotent re-import, audit | Met. Single-record edit screens are API-only (no UI yet) |
| Attendance submit/approval/correction and offline flow with clear states | Met in API; manager correction screen not built (API only) |
| Coffee and pepper weigh-in, server-side totals, idempotency, correction audit | Met in API; correction screen not built (API only) |
| Configurable Daily log | Met; which readings is still open (OC-100) |
| Daily summary separates synced and pending | Met |
| Staging acceptance by owner, accessibility and small-screen review, restore/rollback drill, no critical/high findings, manual production gate | **Not met**: staging is live at glazebrooke-staging.oneuptech.co (tenant `glazebrooke`, synthetic workers and fields); owner acceptance, restore drill and scans still to do |

## Go-live (1 November 2026) readiness

Not ready to promise. The code for the Phase 1A flows exists and is tested locally, but these must happen first:

1. **Production resources** (needs your go-ahead): D1 `cemms-control-production`, R2, queues, secrets and `glazebrooke.oneuptech.co`. Staging is done. The Workers Paid plan is needed (each sign-in uses about 50 ms CPU).
2. **Owner answers or explicit acceptance of interim behaviour** for the 25 open questions that block production (see `docs/owner-confirmations.md`, for example OC-7 approver, OC-8 attendance types, OC-17/18/19/87 weigh-in rules, OC-86 back-entry, OC-101 offline session, OC-103 duplicates).
3. **Real master data** (OC-15): estates, fields with crops and varieties, job types, workers in the CSV templates.
4. **Staging acceptance** on real phones (Android Chrome and iOS Safari), including airplane-mode capture, and a restore drill.

If these cannot all finish by 31 October, the safe plan is: staging on 30–31 October, owner acceptance, production on the first day the gates are cleared; paper registers in the meantime, typed in later through the manager back-entry path.

## Glazebrooke addresses (28 October)

All features are developed on `glazebrooke-staging.oneuptech.co` and go live on `glazebrooke.oneuptech.co` after validation. The address decides the tenant, so sign-in asks only for user name and password (ADR-0010). Other tenants come later on their own addresses with no code change.

## Staging finding (28 October)

Production Workers refuse PBKDF2 above 100,000 iterations per call (local workerd allowed it). Fixed with six chained rounds (ADR-0009, approved), and `crypto.ts` now enforces the limit locally so tests catch it.

## Known limitations

- No local PIN lock: after a reload without signal, the phone keeps accepting entries for the signed-in supervisor until the session ends (12 hours default).
- Manager correction screens, monthly attendance view, exports and single-record master editing exist only as API endpoints or not at all.
- English only (OC-64). No SMS/WhatsApp summaries (OC-94).
- Nightly backups (control database and every tenant) are encrypted with the MFA encryption key, read back and checked, shown to the owner in Manage → Backups, and can be restored into a new database (docs/operations/backup-and-restore.md). A separate backup key is planned; keep a second copy of each environment's key. Backups are not yet copied outside Cloudflare.
- Rate limiting binding is approximate per location; lockout in D1 is the strict control.
- Queue consumer only logs events (no Phase 1A subscribers).
- WAF rules are not yet configured on the zone.

## Next safe actions

0. Google Drive backup copy: get the owner's Gmail, have the owner approve the Drive sign-in once (staging, then production), and fix `GDRIVE_CLIENT_ID` on staging. Decide whether to build the Connect Google Drive button (docs/operations/backup-and-restore.md, "Where it stands").

1. Add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as GitHub secrets (staging environment) so CI can deploy staging.
2. Owner acceptance on staging with real phones; restore drill.
3. Send the owner the blocking questions; collect the master lists.
4. Add the manager correction screens, Playwright end-to-end tests and a PIN lock.
