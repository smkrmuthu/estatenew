# Data Model (ERD)

Two kinds of database (ADR-0001). Business rows keep `tenant_id` (and `estate_id` where relevant) even inside a tenant's own database, as a second check and for moving data.

## Control database (D1 `cemms-control-<env>`) — built

```mermaid
erDiagram
  tenants ||--o{ users : has
  tenants ||--o{ devices : has
  users ||--o{ user_grants : "role per estate ('' = all)"
  users ||--o{ sessions : opens
  devices ||--o{ sessions : "bound to"
  sessions ||--o{ refresh_tokens : "rotates (hash only)"
  tenants { text id PK; text code UK; text db_name UK "Durable Object name"; text status; text location_hint }
  users { text id PK; text tenant_id FK; text username "unique per tenant"; text password_hash "PBKDF2-SHA256 600k"; int failed_attempts; text locked_until; text mfa_secret_enc "AES-GCM"; int mfa_last_step "TOTP replay guard" }
  user_grants { text user_id FK; text estate_key "'' = tenant-wide"; text role }
  sessions { text id PK; text device_id FK; int mfa_verified; text expires_at; text revoked_at }
  refresh_tokens { text token_hash PK; text session_id FK; text used_at "reuse = revoke session" }
  platform_audit { text id PK; text actor; text action; text tenant_id }
```

## Tenant database (one SQLite Durable Object per tenant) — Phase 1A built

```mermaid
erDiagram
  estates ||--o{ fields : has
  estates ||--o{ workers : employs
  fields }o--o{ varieties : "field_varieties"
  estates ||--o{ attendance_sheets : "one per day"
  attendance_sheets ||--o{ attendance_records : "one per worker"
  workers ||--o{ attendance_records : ""
  fields ||--o{ attendance_records : "assigned"
  job_types ||--o{ attendance_records : "assigned"
  workers ||--o{ muster_entries : "weigh-ins"
  fields ||--o{ muster_entries : "picked from"
  varieties |o--o{ muster_entries : "optional"
  log_kinds ||--o{ dailylog_entries : ""
  attendance_records ||--o{ sync_conflicts : "duplicate / stale"
  estates { text id PK; text code UK; text time_zone }
  fields { text id PK; text estate_id FK; text code "unique per estate"; int area_centi_acres; text crops_json "COFFEE, PEPPER or both" }
  varieties { text id PK; text code UK; text crop }
  workers { text id PK; text estate_id FK; text employee_code UK }
  attendance_sheets { text id PK; text business_date; text state "DRAFT SUBMITTED APPROVED" }
  attendance_records { text id PK "UUIDv7 from device"; text worker_id FK; text status_code; text presence; text day_fraction; int version }
  muster_entries { text id PK "UUIDv7 from device"; text crop; int gross_g; int bags; int tare_g; int net_g "CHECK net = gross - tare"; text status "ACTIVE VOID" }
  log_kinds { text id PK; text value_type; int decimals; int min_scaled; int max_scaled }
  dailylog_entries { text id PK; text kind_id FK; int value_scaled; text value_text }
```

Cross-cutting tenant tables: `settings` (gated configuration), `gate_confirmations` (owner answers for this tenant), `record_revisions` (every version of every operational record, append-only), `audit_log`, `outbox_events` (transactional outbox), `sync_mutations` (stored acknowledgements; primary key `device_id, mutation_id`), `device_status` (reported waiting counts), `import_runs` (idempotent CSV imports, unique `kind, file_hash`), `_migrations`.

Rules enforced in the schema: unique `(estate_id, business_date, worker_id)` for attendance; unique `(estate_id, business_date)` for sheets; non-negative weights and `net_g = gross_g - tare_g`; exactly one of `value_scaled` / `value_text`; foreign keys within the tenant database.

## Phase 1B (designed in the architecture document, not built)

Intake lots and allocations (kilogram links from muster entries), route templates and versions, batches, stage runs, measurements, stage logs, approvals, batch relations (split/merge), packed lots, pack units and their sources, trace snapshots. These attach to `muster_entries.id`, keep crop through lineage, and stay gated on AQ-6, AQ-23, AQ-30 and the processing questions (OC-23 to OC-60).
