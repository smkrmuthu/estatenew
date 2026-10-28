// Tenant database, version 1. Applied inside each TenantDb Durable Object (ADR-0005).
// Never edit an applied migration; add a new numbered file instead.
export default /* sql */ `
CREATE TABLE tenant_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  basis TEXT NOT NULL,
  version INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

CREATE TABLE gate_confirmations (
  gate_id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('confirmed', 'open', 'answered-unclear')),
  answer TEXT,
  approver TEXT,
  decided_on TEXT,
  source TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

CREATE TABLE estates (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  time_zone TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

CREATE TABLE varieties (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  crop TEXT NOT NULL CHECK (crop IN ('COFFEE', 'PEPPER')),
  active INTEGER NOT NULL DEFAULT 1,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

CREATE TABLE fields (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  estate_id TEXT NOT NULL REFERENCES estates(id),
  code TEXT NOT NULL COLLATE NOCASE,
  name TEXT NOT NULL,
  area_centi_acres INTEGER CHECK (area_centi_acres IS NULL OR area_centi_acres >= 0),
  crops_json TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  UNIQUE (estate_id, code)
);

CREATE TABLE field_varieties (
  field_id TEXT NOT NULL REFERENCES fields(id),
  variety_id TEXT NOT NULL REFERENCES varieties(id),
  PRIMARY KEY (field_id, variety_id)
);

CREATE TABLE job_types (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

CREATE TABLE workers (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  estate_id TEXT NOT NULL REFERENCES estates(id),
  employee_code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);
CREATE INDEX workers_estate ON workers(estate_id, active);

CREATE TABLE log_kinds (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  label TEXT NOT NULL,
  unit TEXT,
  value_type TEXT NOT NULL CHECK (value_type IN ('NUMBER', 'TEXT')),
  decimals INTEGER NOT NULL CHECK (decimals BETWEEN 0 AND 3),
  min_scaled INTEGER,
  max_scaled INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  basis TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

CREATE TABLE attendance_sheets (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  estate_id TEXT NOT NULL REFERENCES estates(id),
  business_date TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('DRAFT', 'SUBMITTED', 'APPROVED')),
  submitted_at TEXT,
  submitted_by TEXT,
  approved_at TEXT,
  approved_by TEXT,
  returned_reason TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (estate_id, business_date)
);

CREATE TABLE attendance_records (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  estate_id TEXT NOT NULL REFERENCES estates(id),
  sheet_id TEXT NOT NULL REFERENCES attendance_sheets(id),
  business_date TEXT NOT NULL,
  worker_id TEXT NOT NULL REFERENCES workers(id),
  status_code TEXT NOT NULL,
  presence TEXT NOT NULL,
  day_fraction TEXT CHECK (day_fraction IS NULL OR day_fraction IN ('FULL', 'HALF')),
  field_id TEXT REFERENCES fields(id),
  job_type_id TEXT REFERENCES job_types(id),
  remarks TEXT,
  captured_by TEXT NOT NULL,
  device_id TEXT,
  captured_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE (estate_id, business_date, worker_id)
);
CREATE INDEX attendance_records_sheet ON attendance_records(sheet_id);

CREATE TABLE muster_entries (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  estate_id TEXT NOT NULL REFERENCES estates(id),
  business_date TEXT NOT NULL,
  worker_id TEXT NOT NULL REFERENCES workers(id),
  field_id TEXT NOT NULL REFERENCES fields(id),
  subdivision TEXT,
  crop TEXT NOT NULL CHECK (crop IN ('COFFEE', 'PEPPER')),
  variety_id TEXT REFERENCES varieties(id),
  gross_g INTEGER NOT NULL CHECK (gross_g >= 0),
  bags INTEGER NOT NULL CHECK (bags >= 0),
  tare_g INTEGER NOT NULL CHECK (tare_g >= 0),
  net_g INTEGER NOT NULL CHECK (net_g >= 0 AND net_g = gross_g - tare_g),
  tare_mode TEXT NOT NULL,
  remarks TEXT,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'VOID')),
  void_reason TEXT,
  captured_by TEXT NOT NULL,
  device_id TEXT,
  captured_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX muster_entries_day ON muster_entries(estate_id, business_date);
CREATE INDEX muster_entries_worker ON muster_entries(worker_id, business_date);

CREATE TABLE dailylog_entries (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  estate_id TEXT NOT NULL REFERENCES estates(id),
  business_date TEXT NOT NULL,
  kind_id TEXT NOT NULL REFERENCES log_kinds(id),
  reading_at TEXT NOT NULL,
  value_scaled INTEGER,
  value_text TEXT,
  remarks TEXT,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'VOID')),
  void_reason TEXT,
  captured_by TEXT NOT NULL,
  device_id TEXT,
  captured_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  CHECK ((value_scaled IS NULL) <> (value_text IS NULL))
);
CREATE INDEX dailylog_entries_day ON dailylog_entries(estate_id, business_date);

-- Append-only history of every version of every operational record.
CREATE TABLE record_revisions (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  data_json TEXT NOT NULL,
  change TEXT NOT NULL,
  reason TEXT,
  actor_user_id TEXT NOT NULL,
  mutation_id TEXT,
  at TEXT NOT NULL,
  UNIQUE (entity_type, entity_id, version)
);

CREATE TABLE sync_mutations (
  device_id TEXT NOT NULL,
  mutation_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  result_json TEXT NOT NULL,
  user_id TEXT NOT NULL,
  received_at TEXT NOT NULL,
  PRIMARY KEY (device_id, mutation_id)
);

CREATE TABLE sync_conflicts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  estate_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  server_entity_id TEXT NOT NULL,
  incoming_entity_id TEXT NOT NULL,
  incoming_json TEXT NOT NULL,
  server_json TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('OPEN', 'RESOLVED')),
  kept TEXT CHECK (kept IS NULL OR kept IN ('server', 'incoming')),
  reason TEXT,
  resolved_by TEXT,
  resolved_at TEXT,
  mutation_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  captured_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX sync_conflicts_open ON sync_conflicts(estate_id, state);

CREATE TABLE device_status (
  device_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  estate_ids_json TEXT NOT NULL,
  pending_count INTEGER NOT NULL,
  last_sync_at TEXT NOT NULL
);

CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  estate_id TEXT,
  actor_user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  request_id TEXT,
  device_id TEXT,
  mutation_id TEXT,
  reason TEXT,
  before_json TEXT,
  after_json TEXT,
  at TEXT NOT NULL
);
CREATE INDEX audit_log_entity ON audit_log(entity_type, entity_id);
CREATE INDEX audit_log_at ON audit_log(at);

CREATE TABLE outbox_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  published_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX outbox_unpublished ON outbox_events(published_at, created_at);

CREATE TABLE import_runs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  result_json TEXT NOT NULL,
  committed_by TEXT NOT NULL,
  committed_at TEXT NOT NULL,
  UNIQUE (kind, file_hash)
);
`;
