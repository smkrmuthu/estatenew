import { TENANT_MIGRATIONS } from "./migrations";

export interface MigrationState {
  version: number;
  applied: { version: number; name: string; appliedAt: string }[];
  error: string | null;
}

/** FNV-1a 32-bit checksum (sync, enough to detect an edited migration). */
export function checksum(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * Apply pending migrations in order. Runs inside blockConcurrencyWhile, so no request
 * sees a half-migrated database; each migration commits atomically with its record.
 */
export function runTenantMigrations(storage: DurableObjectStorage, now: () => string = () => new Date().toISOString()): MigrationState {
  const sql = storage.sql;
  sql.exec("CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL)");
  const applied = new Map(
    sql
      .exec<{ version: number; name: string; checksum: string; applied_at: string }>("SELECT version, name, checksum, applied_at FROM _migrations ORDER BY version")
      .toArray()
      .map((r) => [r.version, r]),
  );
  for (const m of TENANT_MIGRATIONS) {
    const sum = checksum(m.sql);
    const done = applied.get(m.version);
    if (done) {
      if (done.checksum !== sum) {
        return {
          version: Math.max(0, ...applied.keys()),
          applied: [...applied.values()].map((a) => ({ version: a.version, name: a.name, appliedAt: a.applied_at })),
          error: `Migration ${m.version} (${m.name}) was changed after it was applied`,
        };
      }
      continue;
    }
    storage.transactionSync(() => {
      sql.exec(m.sql);
      sql.exec("INSERT INTO _migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)", m.version, m.name, sum, now());
    });
    applied.set(m.version, { version: m.version, name: m.name, checksum: sum, applied_at: now() });
  }
  return { version: Math.max(0, ...applied.keys()), applied: [...applied.values()].map((a) => ({ version: a.version, name: a.name, appliedAt: a.applied_at })), error: null };
}
