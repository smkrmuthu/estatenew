import type { Mutation } from "@cemms/contracts";
import { canonicalJson, SYNC_SCHEMA_VERSION, type SyncEntityType, type SyncOp, sha256Hex, uuidv7 } from "@cemms/domain";
import { db, type LocalRecord } from "./db";

export interface QueueInput {
  tenantId: string;
  userId: string;
  deviceId: string;
  entityType: SyncEntityType;
  op: SyncOp;
  estateId: string;
  businessDate: string;
  entityId?: string;
  payload: Record<string, unknown>;
  label: string;
  /** Store a local copy (for screens) unless false. */
  keepRecord?: boolean;
}

let persistAsked = false;

/**
 * Save a change on the phone: the local record and its outbox mutation are written in one
 * IndexedDB transaction before the screen says "Saved on this phone".
 */
export async function queueChange(input: QueueInput): Promise<{ entityId: string; mutationId: string }> {
  if (!persistAsked && typeof navigator !== "undefined" && navigator.storage?.persist) {
    persistAsked = true;
    void navigator.storage.persist();
  }
  const entityId = input.entityId ?? uuidv7();
  const key = `${input.entityType}:${entityId}`;
  const mutationId = uuidv7();
  const payloadHash = await sha256Hex(canonicalJson(input.payload));
  const now = new Date().toISOString();
  await db.transaction("rw", db.outbox, db.records, async () => {
    const existing = await db.records.get(key);
    const baseVersion = existing?.nextBase ?? 0;
    const envelope: Mutation = {
      mutationId,
      entityType: input.entityType,
      entityId,
      op: input.op,
      estateId: input.estateId,
      deviceId: input.deviceId,
      schemaVersion: SYNC_SCHEMA_VERSION,
      capturedAt: now,
      baseVersion,
      payload: input.payload,
      payloadHash,
    };
    await db.outbox.add({ mutationId, createdAt: now, tenantId: input.tenantId, userId: input.userId, status: "waiting", attempts: 0, nextAttemptAt: 0, label: input.label, envelope });
    if (input.keepRecord !== false) {
      const record: LocalRecord = {
        key,
        tenantId: input.tenantId,
        entityType: input.entityType,
        entityId,
        estateId: input.estateId,
        businessDate: input.businessDate,
        data: { ...(existing?.data ?? {}), ...input.payload, ...(input.op === "void" ? { status: "VOID" } : {}) },
        status: "waiting",
        serverVersion: existing?.serverVersion ?? 0,
        nextBase: baseVersion + 1,
        lastMutationId: mutationId,
        updatedAt: now,
      };
      await db.records.put(record);
    }
  });
  return { entityId, mutationId };
}

export async function counts(userId: string) {
  const all = await db.outbox.toArray();
  const mine = all.filter((o) => o.userId === userId);
  return {
    waiting: mine.filter((o) => o.status === "waiting").length,
    rejected: mine.filter((o) => o.status === "rejected").length,
    conflict: mine.filter((o) => o.status === "conflict").length,
    otherUsersWaiting: all.filter((o) => o.userId !== userId && o.status === "waiting").length,
  };
}

/** Remove a rejected change after the user has read why. The server never had it. */
export async function dismissRejected(mutationId: string) {
  await db.transaction("rw", db.outbox, db.records, async () => {
    const item = await db.outbox.get(mutationId);
    if (item?.status !== "rejected") return;
    await db.outbox.delete(mutationId);
    const key = `${item.envelope.entityType}:${item.envelope.entityId}`;
    const rec = await db.records.get(key);
    if (!rec || rec.lastMutationId !== mutationId) return;
    // Weigh-ins and Daily log readings are listed from the server, so dropping the rejected local copy brings back what the server holds.
    const listedFromServer = item.envelope.entityType === "muster_entry" || item.envelope.entityType === "dailylog_entry";
    if (rec.serverVersion === 0 || listedFromServer) await db.records.delete(key);
  });
}
