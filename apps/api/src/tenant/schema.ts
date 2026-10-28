import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Mirrors migrations/*.ts. The SQL migrations are the source of truth for the tenant schema.

const audit = {
  version: integer("version").notNull().default(1),
  createdAt: text("created_at").notNull(),
  createdBy: text("created_by").notNull(),
  updatedAt: text("updated_at").notNull(),
  updatedBy: text("updated_by").notNull(),
};

export const tenantMeta = sqliteTable("tenant_meta", { key: text("key").primaryKey(), value: text("value").notNull() });

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  valueJson: text("value_json").notNull(),
  basis: text("basis").notNull(),
  version: integer("version").notNull(),
  updatedAt: text("updated_at").notNull(),
  updatedBy: text("updated_by").notNull(),
});

export const gateConfirmations = sqliteTable("gate_confirmations", {
  gateId: text("gate_id").primaryKey(),
  status: text("status", { enum: ["confirmed", "open", "answered-unclear"] }).notNull(),
  answer: text("answer"),
  approver: text("approver"),
  decidedOn: text("decided_on"),
  source: text("source").notNull(),
  updatedAt: text("updated_at").notNull(),
  updatedBy: text("updated_by").notNull(),
});

export const estates = sqliteTable("estates", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  timeZone: text("time_zone").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  ...audit,
});

export const varieties = sqliteTable("varieties", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  crop: text("crop", { enum: ["COFFEE", "PEPPER"] }).notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  ...audit,
});

export const fields = sqliteTable("fields", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  estateId: text("estate_id").notNull(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  areaCentiAcres: integer("area_centi_acres"),
  cropsJson: text("crops_json").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  ...audit,
});

export const fieldVarieties = sqliteTable("field_varieties", { fieldId: text("field_id").notNull(), varietyId: text("variety_id").notNull() }, (t) => [
  primaryKey({ columns: [t.fieldId, t.varietyId] }),
]);

export const jobTypes = sqliteTable("job_types", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  ...audit,
});

export const workers = sqliteTable("workers", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  estateId: text("estate_id").notNull(),
  employeeCode: text("employee_code").notNull(),
  name: text("name").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  ...audit,
});

export const logKinds = sqliteTable("log_kinds", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  code: text("code").notNull(),
  label: text("label").notNull(),
  unit: text("unit"),
  valueType: text("value_type", { enum: ["NUMBER", "TEXT"] }).notNull(),
  decimals: integer("decimals").notNull(),
  minScaled: integer("min_scaled"),
  maxScaled: integer("max_scaled"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  basis: text("basis").notNull(),
  ...audit,
});

export const attendanceSheets = sqliteTable("attendance_sheets", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  estateId: text("estate_id").notNull(),
  businessDate: text("business_date").notNull(),
  state: text("state", { enum: ["DRAFT", "SUBMITTED", "APPROVED"] }).notNull(),
  submittedAt: text("submitted_at"),
  submittedBy: text("submitted_by"),
  approvedAt: text("approved_at"),
  approvedBy: text("approved_by"),
  returnedReason: text("returned_reason"),
  version: integer("version").notNull().default(1),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

const captured = {
  capturedBy: text("captured_by").notNull(),
  deviceId: text("device_id"),
  capturedAt: text("captured_at").notNull(),
  receivedAt: text("received_at").notNull(),
  version: integer("version").notNull().default(1),
};

export const attendanceRecords = sqliteTable("attendance_records", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  estateId: text("estate_id").notNull(),
  sheetId: text("sheet_id").notNull(),
  businessDate: text("business_date").notNull(),
  workerId: text("worker_id").notNull(),
  statusCode: text("status_code").notNull(),
  presence: text("presence").notNull(),
  dayFraction: text("day_fraction", { enum: ["FULL", "HALF"] }),
  fieldId: text("field_id"),
  jobTypeId: text("job_type_id"),
  remarks: text("remarks"),
  ...captured,
});

export const musterEntries = sqliteTable("muster_entries", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  estateId: text("estate_id").notNull(),
  businessDate: text("business_date").notNull(),
  workerId: text("worker_id").notNull(),
  fieldId: text("field_id").notNull(),
  subdivision: text("subdivision"),
  crop: text("crop", { enum: ["COFFEE", "PEPPER"] }).notNull(),
  varietyId: text("variety_id"),
  grossG: integer("gross_g").notNull(),
  bags: integer("bags").notNull(),
  tareG: integer("tare_g").notNull(),
  netG: integer("net_g").notNull(),
  tareMode: text("tare_mode").notNull(),
  remarks: text("remarks"),
  status: text("status", { enum: ["ACTIVE", "VOID"] }).notNull(),
  voidReason: text("void_reason"),
  ...captured,
});

export const dailylogEntries = sqliteTable("dailylog_entries", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  estateId: text("estate_id").notNull(),
  businessDate: text("business_date").notNull(),
  kindId: text("kind_id").notNull(),
  readingAt: text("reading_at").notNull(),
  valueScaled: integer("value_scaled"),
  valueText: text("value_text"),
  remarks: text("remarks"),
  status: text("status", { enum: ["ACTIVE", "VOID"] }).notNull(),
  voidReason: text("void_reason"),
  ...captured,
});

export const recordRevisions = sqliteTable("record_revisions", {
  id: text("id").primaryKey(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  version: integer("version").notNull(),
  dataJson: text("data_json").notNull(),
  change: text("change").notNull(),
  reason: text("reason"),
  actorUserId: text("actor_user_id").notNull(),
  mutationId: text("mutation_id"),
  at: text("at").notNull(),
});

export const syncMutations = sqliteTable(
  "sync_mutations",
  {
    deviceId: text("device_id").notNull(),
    mutationId: text("mutation_id").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    payloadHash: text("payload_hash").notNull(),
    resultJson: text("result_json").notNull(),
    userId: text("user_id").notNull(),
    receivedAt: text("received_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.deviceId, t.mutationId] })],
);

export const syncConflicts = sqliteTable("sync_conflicts", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  estateId: text("estate_id").notNull(),
  entityType: text("entity_type").notNull(),
  serverEntityId: text("server_entity_id").notNull(),
  incomingEntityId: text("incoming_entity_id").notNull(),
  incomingJson: text("incoming_json").notNull(),
  serverJson: text("server_json").notNull(),
  state: text("state", { enum: ["OPEN", "RESOLVED"] }).notNull(),
  kept: text("kept", { enum: ["server", "incoming"] }),
  reason: text("reason"),
  resolvedBy: text("resolved_by"),
  resolvedAt: text("resolved_at"),
  mutationId: text("mutation_id").notNull(),
  deviceId: text("device_id").notNull(),
  capturedBy: text("captured_by").notNull(),
  createdAt: text("created_at").notNull(),
});

export const deviceStatus = sqliteTable("device_status", {
  deviceId: text("device_id").primaryKey(),
  userId: text("user_id").notNull(),
  estateIdsJson: text("estate_ids_json").notNull(),
  pendingCount: integer("pending_count").notNull(),
  lastSyncAt: text("last_sync_at").notNull(),
});

export const auditLog = sqliteTable("audit_log", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  estateId: text("estate_id"),
  actorUserId: text("actor_user_id").notNull(),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id"),
  requestId: text("request_id"),
  deviceId: text("device_id"),
  mutationId: text("mutation_id"),
  reason: text("reason"),
  beforeJson: text("before_json"),
  afterJson: text("after_json"),
  at: text("at").notNull(),
});

export const outboxEvents = sqliteTable("outbox_events", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  payloadJson: text("payload_json").notNull(),
  createdAt: text("created_at").notNull(),
  publishedAt: text("published_at"),
  attempts: integer("attempts").notNull().default(0),
});

export const importRuns = sqliteTable("import_runs", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  fileHash: text("file_hash").notNull(),
  resultJson: text("result_json").notNull(),
  committedBy: text("committed_by").notNull(),
  committedAt: text("committed_at").notNull(),
});
