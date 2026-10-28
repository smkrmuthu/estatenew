import { controlDb } from "../control/db";
import { tenants } from "../control/schema";
import { decryptSecret, encryptSecret, sha256Hex } from "./crypto";
import { driveConfig, uploadToDrive } from "./gdrive";
import { log } from "./log";
import { tenantStub } from "./tenant-stub";

/**
 * Encrypted copies of every tenant database and of the control database, kept in R2 on top of the
 * 30-day point-in-time restore. Each copy is read back and checked before it counts as good.
 * Copies hold worker names, so they are encrypted with MFA_ENC_KEY; without that key they cannot be read.
 */

export interface BackupManifest {
  kind: "tenant" | "control";
  tenantId: string | null;
  code: string | null;
  /** R2 key of the encrypted copy. */
  key: string;
  at: string;
  trigger: "nightly" | "manual";
  bytes: number;
  /** SHA-256 of the copy before encryption. */
  sha256: string;
  migration: number | null;
  /** Rows per table, for a quick sanity check; no worker data. */
  tables: Record<string, number>;
  /** True when the stored copy was read back, decrypted and matched. */
  verified: boolean;
  /** The second copy in Google Drive; absent when Drive is not set up. */
  offsite?: { provider: "google-drive"; ok: boolean; at: string; fileId?: string; error?: string };
}

/** Credentials that are useless after a restore and better not kept: sign-in sessions and refresh tokens. */
const CONTROL_SKIP = new Set(["sessions", "refresh_tokens", "d1_migrations"]);

const stampOf = (d: Date) => `${d.toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`;

function countTables(plain: string): Record<string, number> {
  const parsed = JSON.parse(plain) as { tables: Record<string, unknown[]> };
  return Object.fromEntries(Object.entries(parsed.tables).map(([name, rows]) => [name, rows.length]));
}

async function store(env: Env, prefix: string, plain: string, meta: Pick<BackupManifest, "kind" | "tenantId" | "code" | "trigger" | "migration">, now: Date): Promise<BackupManifest> {
  const key = `${prefix}/${stampOf(now)}.json.enc`;
  const body = await encryptSecret(plain, env.MFA_ENC_KEY);
  await env.FILES.put(key, body, { customMetadata: { kind: meta.kind, tenantId: meta.tenantId ?? "", trigger: meta.trigger } });
  const sha256 = await sha256Hex(plain);
  // Read the stored copy back: a backup that cannot be read is not a backup.
  const back = await env.FILES.get(key);
  const again = back ? await decryptSecret(await back.text(), env.MFA_ENC_KEY).catch(() => "") : "";
  const verified = again.length > 0 && (await sha256Hex(again)) === sha256;
  const manifest: BackupManifest = { ...meta, key, at: now.toISOString(), bytes: body.length, sha256, tables: countTables(plain), verified };
  const manifestKey = `${prefix}/${stampOf(now)}.manifest.json`;
  await env.FILES.put(manifestKey, JSON.stringify(manifest), { httpMetadata: { contentType: "application/json" } });
  if (!verified) throw new Error(`Backup ${key} could not be read back`);
  // The second copy in Google Drive. A failure there is recorded and logged but never loses the R2 copy.
  const drive = driveConfig(env);
  if (drive) {
    const name = key.replace(/^tenants\/([^/]+)\/backups\//, "tenant-$1-").replace(/^control\/backups\//, "control-");
    try {
      const sent = await uploadToDrive(drive, `CEMMS backups - ${env.ENVIRONMENT}`, [
        { name, mime: "text/plain", body },
        { name: name.replace(/\.json\.enc$/, ".manifest.json"), mime: "application/json", body: JSON.stringify({ ...manifest, offsite: undefined }) },
      ]);
      manifest.offsite = { provider: "google-drive", ok: true, at: new Date().toISOString(), fileId: sent.files[0]?.id };
    } catch (e) {
      manifest.offsite = { provider: "google-drive", ok: false, at: new Date().toISOString(), error: (e as Error).message.slice(0, 300) };
      log("error", "backup.offsite.failed", { key, error: manifest.offsite.error });
    }
    await env.FILES.put(manifestKey, JSON.stringify(manifest), { httpMetadata: { contentType: "application/json" } });
  }
  return manifest;
}

export async function backupTenant(env: Env, t: { id: string; code: string; dbName: string }, trigger: BackupManifest["trigger"], now = new Date()): Promise<BackupManifest> {
  const snapshot = await tenantStub(env, t.dbName).snapshot(t.id);
  const migration = (JSON.parse(snapshot) as { migration: number }).migration;
  return store(env, `tenants/${t.id}/backups`, snapshot, { kind: "tenant", tenantId: t.id, code: t.code, trigger, migration }, now);
}

/** The sign-in side: tenants, users, grants, devices, domains and the platform audit. */
export async function backupControl(env: Env, trigger: BackupManifest["trigger"], now = new Date()): Promise<BackupManifest> {
  const names = (await env.CONTROL_DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'").all<{ name: string }>()).results
    .map((r) => r.name)
    .filter((n) => !CONTROL_SKIP.has(n));
  const tables: Record<string, unknown[]> = {};
  for (const n of names) tables[n] = (await env.CONTROL_DB.prepare(`SELECT * FROM "${n.replaceAll('"', "")}"`).all()).results;
  return store(env, "control/backups", JSON.stringify({ at: now.toISOString(), tables }), { kind: "control", tenantId: null, code: null, trigger, migration: null }, now);
}

export interface BackupRun {
  ok: boolean;
  results: ({ kind: "tenant" | "control"; code: string | null; ok: true; manifest: BackupManifest } | { kind: "tenant" | "control"; code: string | null; ok: false; error: string })[];
}

/** Back up the control database and every tenant. One failure does not stop the others. */
export async function runAllBackups(env: Env, trigger: BackupManifest["trigger"], now = new Date()): Promise<BackupRun> {
  const results: BackupRun["results"] = [];
  try {
    results.push({ kind: "control", code: null, ok: true, manifest: await backupControl(env, trigger, now) });
  } catch (e) {
    log("error", "backup.failed", { kind: "control", error: (e as Error).message });
    results.push({ kind: "control", code: null, ok: false, error: (e as Error).message });
  }
  for (const t of await controlDb(env).select().from(tenants).all()) {
    try {
      const manifest = await backupTenant(env, t, trigger, now);
      log("info", "backup.done", { tenantId: t.id, bytes: manifest.bytes, verified: manifest.verified });
      results.push({ kind: "tenant", code: t.code, ok: true, manifest });
    } catch (e) {
      log("error", "backup.failed", { tenantId: t.id, error: (e as Error).message });
      results.push({ kind: "tenant", code: t.code, ok: false, error: (e as Error).message });
    }
  }
  return { ok: results.every((r) => r.ok), results };
}

/** The newest manifests under a prefix, newest first. */
export async function listBackups(env: Env, prefix: string, limit = 10): Promise<BackupManifest[]> {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.FILES.list({ prefix: `${prefix}/`, cursor, limit: 1000 });
    for (const o of page.objects) if (o.key.endsWith(".manifest.json")) keys.push(o.key);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  const out: BackupManifest[] = [];
  for (const key of keys.sort().reverse().slice(0, limit)) {
    const o = await env.FILES.get(key);
    if (o) out.push((await o.json()) as BackupManifest);
  }
  return out;
}

/** A copy's plain text, after checking it against the manifest. */
export async function readBackup(env: Env, manifest: BackupManifest): Promise<string> {
  const o = await env.FILES.get(manifest.key);
  if (!o) throw new Error("The backup file is missing");
  const plain = await decryptSecret(await o.text(), env.MFA_ENC_KEY);
  if ((await sha256Hex(plain)) !== manifest.sha256) throw new Error("The backup does not match its checksum");
  return plain;
}

/** Hours since the newest verified copy, or null when there is none. */
export function ageHours(manifests: BackupManifest[], now = new Date()): number | null {
  const last = manifests.find((m) => m.verified);
  return last ? Math.round(((now.getTime() - Date.parse(last.at)) / 3_600_000) * 10) / 10 : null;
}
