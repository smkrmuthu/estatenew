/**
 * A worker can have a Day row and a Night row on the same date (a field job by day, a night watch
 * by night). Each shift has its own register and its own submit and approval. The unique keys of
 * attendance_sheets and attendance_records cannot be widened in place, so both tables are rebuilt
 * (child first when dropping). Existing rows become DAY shift and keep their ids.
 */
export default `
CREATE TABLE attendance_sheets_new (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  estate_id TEXT NOT NULL REFERENCES estates(id),
  business_date TEXT NOT NULL,
  shift TEXT NOT NULL DEFAULT 'DAY' CHECK (shift IN ('DAY', 'NIGHT')),
  state TEXT NOT NULL CHECK (state IN ('DRAFT', 'SUBMITTED', 'APPROVED')),
  submitted_at TEXT,
  submitted_by TEXT,
  approved_at TEXT,
  approved_by TEXT,
  returned_reason TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (estate_id, business_date, shift)
);
INSERT INTO attendance_sheets_new (id, tenant_id, estate_id, business_date, shift, state, submitted_at, submitted_by, approved_at, approved_by, returned_reason, version, created_at, updated_at)
  SELECT id, tenant_id, estate_id, business_date, 'DAY', state, submitted_at, submitted_by, approved_at, approved_by, returned_reason, version, created_at, updated_at FROM attendance_sheets;

CREATE TABLE attendance_records_new (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  estate_id TEXT NOT NULL REFERENCES estates(id),
  sheet_id TEXT NOT NULL REFERENCES attendance_sheets_new(id),
  business_date TEXT NOT NULL,
  shift TEXT NOT NULL DEFAULT 'DAY' CHECK (shift IN ('DAY', 'NIGHT')),
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
  UNIQUE (estate_id, business_date, worker_id, shift)
);
INSERT INTO attendance_records_new (id, tenant_id, estate_id, sheet_id, business_date, shift, worker_id, status_code, presence, day_fraction, field_id, job_type_id, remarks, captured_by, device_id, captured_at, received_at, version)
  SELECT id, tenant_id, estate_id, sheet_id, business_date, 'DAY', worker_id, status_code, presence, day_fraction, field_id, job_type_id, remarks, captured_by, device_id, captured_at, received_at, version FROM attendance_records;

DROP TABLE attendance_records;
DROP TABLE attendance_sheets;
ALTER TABLE attendance_sheets_new RENAME TO attendance_sheets;
ALTER TABLE attendance_records_new RENAME TO attendance_records;
CREATE INDEX attendance_records_sheet ON attendance_records(sheet_id);
`;
