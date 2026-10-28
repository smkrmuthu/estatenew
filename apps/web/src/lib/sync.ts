import { backoffMs, MAX_SYNC_BATCH, type SyncItemResult } from "@cemms/domain";
import { ApiError, api, hasAccess, refreshAccess } from "./api";
import { db, type OutboxItem, setMeta } from "./db";

export interface SyncReport {
  sent: number;
  accepted: number;
  rejected: number;
  conflict: number;
  error?: string;
}

const BATCH = Math.min(50, MAX_SYNC_BATCH);
let running: Promise<SyncReport> | null = null;

/** Apply one server result to the outbox item and the local record, atomically. */
export async function applyResult(item: OutboxItem, r: SyncItemResult): Promise<void> {
  await db.transaction("rw", db.outbox, db.records, async () => {
    const key = `${item.envelope.entityType}:${item.envelope.entityId}`;
    const rec = await db.records.get(key);
    if (r.status === "rejected" && r.retryable) {
      const attempts = item.attempts + 1;
      await db.outbox.update(item.mutationId, { attempts, nextAttemptAt: Date.now() + backoffMs(attempts), result: r });
      return;
    }
    await db.outbox.update(item.mutationId, { status: r.status, result: r, attempts: item.attempts + 1 });
    if (!rec) return;
    const latest = rec.lastMutationId === item.mutationId;
    if (r.status === "accepted") {
      // An older change to the same record that was refused is now out of date: drop it.
      const stale = await db.outbox
        .where("status")
        .equals("rejected")
        .filter((o) => o.envelope.entityType === item.envelope.entityType && o.envelope.entityId === item.envelope.entityId && o.createdAt < item.createdAt)
        .primaryKeys();
      await db.outbox.bulkDelete(stale);
      const serverVersion = r.version ?? rec.serverVersion;
      await db.records.update(key, { serverVersion, ...(latest ? { status: "accepted", message: undefined, nextBase: serverVersion } : {}) });
    } else if (latest) {
      // The server did not take this change: the next change starts again from the server's version.
      await db.records.update(key, { status: r.status, message: r.message ?? r.errorCode, nextBase: r.status === "conflict" ? (r.version ?? rec.serverVersion) : rec.serverVersion });
    }
  });
}

async function runOnce(userId: string, deviceId: string): Promise<SyncReport> {
  const report: SyncReport = { sent: 0, accepted: 0, rejected: 0, conflict: 0 };
  if (typeof navigator !== "undefined" && navigator.onLine === false) return { ...report, error: "offline" };
  if (!hasAccess() && !(await refreshAccess())) return { ...report, error: "signed-out" };
  for (;;) {
    const due = (await db.outbox.where({ userId, status: "waiting" }).sortBy("createdAt")).filter((o) => o.nextAttemptAt <= Date.now());
    if (due.length === 0) break;
    const batch = due.slice(0, BATCH);
    const pendingAfter = (await db.outbox.where({ userId, status: "waiting" }).count()) - batch.length;
    let results: SyncItemResult[];
    try {
      results = (await api<{ results: SyncItemResult[] }>("/sync/push", { body: { deviceId, pendingCount: Math.max(0, pendingAfter), mutations: batch.map((b) => b.envelope) } })).results;
    } catch (e) {
      // Whole batch failed (network, session): try again later, nothing is lost.
      for (const item of batch) await db.outbox.update(item.mutationId, { attempts: item.attempts + 1, nextAttemptAt: Date.now() + backoffMs(item.attempts + 1) });
      return { ...report, error: e instanceof ApiError ? e.message : "network" };
    }
    const byId = new Map(results.map((r) => [r.mutationId, r]));
    for (const item of batch) {
      const r = byId.get(item.mutationId);
      if (!r) continue;
      await applyResult(item, r);
      report.sent++;
      if (r.status === "accepted") report.accepted++;
      else if (r.status === "conflict") report.conflict++;
      else if (!r.retryable) report.rejected++;
    }
    if (batch.every((b) => byId.get(b.mutationId)?.retryable)) break;
  }
  await setMeta("lastSyncAt", new Date().toISOString());
  return report;
}

/** One sync at a time across tabs (Web Locks where available). */
export function syncNow(userId: string, deviceId: string, force = false): Promise<SyncReport> {
  running ??= (async () => {
    // A tap on "Sync now" should not wait for the retry back-off.
    if (force) await db.outbox.where({ userId, status: "waiting" }).modify({ nextAttemptAt: 0 });
    try {
      const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
      return locks ? await locks.request("cemms-sync", () => runOnce(userId, deviceId)) : await runOnce(userId, deviceId);
    } finally {
      running = null;
    }
  })();
  return running;
}

/** Sync on open, focus, coming back online and every minute while open (no Background Sync). */
export function startAutoSync(userId: string, deviceId: string, onDone: (r: SyncReport) => void): () => void {
  const go = () => void syncNow(userId, deviceId).then(onDone);
  const onVisible = () => document.visibilityState === "visible" && go();
  window.addEventListener("online", go);
  window.addEventListener("focus", go);
  document.addEventListener("visibilitychange", onVisible);
  const timer = window.setInterval(go, 60_000);
  go();
  return () => {
    window.removeEventListener("online", go);
    window.removeEventListener("focus", go);
    document.removeEventListener("visibilitychange", onVisible);
    window.clearInterval(timer);
  };
}
