-- Each tenant can be reached on its own address (for example glazebrooke.oneuptech.co).
-- The site address decides the tenant, so users do not type a group code.
CREATE TABLE tenant_domains (
  domain TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  created_at TEXT NOT NULL
);
CREATE INDEX tenant_domains_tenant ON tenant_domains(tenant_id);
