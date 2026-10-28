import { index, integer, primaryKey, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";

// Mirrors db/control/*.sql (the SQL migrations are the source of truth for the D1 schema).

export const tenants = sqliteTable("tenants", {
  id: text("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  status: text("status", { enum: ["ACTIVE", "SUSPENDED"] }).notNull(),
  dbName: text("db_name").notNull().unique(),
  locationHint: text("location_hint"),
  provisionedAt: text("provisioned_at"),
  createdAt: text("created_at").notNull(),
});

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    username: text("username").notNull(),
    displayName: text("display_name").notNull(),
    passwordHash: text("password_hash").notNull(),
    status: text("status", { enum: ["ACTIVE", "DISABLED"] }).notNull(),
    failedAttempts: integer("failed_attempts").notNull().default(0),
    lockedUntil: text("locked_until"),
    mfaSecretEnc: text("mfa_secret_enc"),
    mfaEnabled: integer("mfa_enabled", { mode: "boolean" }).notNull().default(false),
    mfaLastStep: integer("mfa_last_step"),
    mustChangePassword: integer("must_change_password", { mode: "boolean" }).notNull().default(false),
    passwordChangedAt: text("password_changed_at").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [unique().on(t.tenantId, t.username)],
);

export const userGrants = sqliteTable(
  "user_grants",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    userId: text("user_id").notNull(),
    estateKey: text("estate_key").notNull(),
    role: text("role").notNull(),
    createdAt: text("created_at").notNull(),
    createdBy: text("created_by").notNull(),
  },
  (t) => [unique().on(t.userId, t.estateKey, t.role), index("user_grants_user").on(t.userId)],
);

export const devices = sqliteTable("devices", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  userId: text("user_id").notNull(),
  label: text("label"),
  createdAt: text("created_at").notNull(),
  lastSeenAt: text("last_seen_at"),
  revokedAt: text("revoked_at"),
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  userId: text("user_id").notNull(),
  deviceId: text("device_id").notNull(),
  mfaVerified: integer("mfa_verified", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull(),
  revokedAt: text("revoked_at"),
  revokedReason: text("revoked_reason"),
});

export const refreshTokens = sqliteTable(
  "refresh_tokens",
  {
    tokenHash: text("token_hash").notNull(),
    sessionId: text("session_id").notNull(),
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at").notNull(),
    usedAt: text("used_at"),
  },
  (t) => [primaryKey({ columns: [t.tokenHash] })],
);

export const platformAudit = sqliteTable("platform_audit", {
  id: text("id").primaryKey(),
  at: text("at").notNull(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  tenantId: text("tenant_id"),
  userId: text("user_id"),
  requestId: text("request_id"),
  detailJson: text("detail_json"),
});

export const tenantDomains = sqliteTable("tenant_domains", {
  domain: text("domain").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  createdAt: text("created_at").notNull(),
});
