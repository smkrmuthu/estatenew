import type { Mutation } from "@cemms/contracts";
import type { SyncItemResult } from "@cemms/domain";
import Dexie, { type EntityTable } from "dexie";

/** Waiting = on this phone only; the server has not accepted it yet. */
export type LocalStatus = "waiting" | "accepted" | "rejected" | "conflict";

export interface OutboxItem {
  mutationId: string;
  createdAt: string;
  tenantId: string;
  userId: string;
  status: LocalStatus;
  attempts: number;
  nextAttemptAt: number;
  label: string;
  envelope: Mutation;
  result?: SyncItemResult;
}

export interface LocalRecord {
  key: string;
  tenantId: string;
  entityType: string;
  entityId: string;
  estateId: string;
  businessDate: string;
  data: Record<string, unknown>;
  status: LocalStatus;
  /** Version the server last confirmed (0 = never). */
  serverVersion: number;
  /** baseVersion to use for the next queued change to this record. */
  nextBase: number;
  /** The newest mutation queued for this record. */
  lastMutationId: string;
  message?: string;
  updatedAt: string;
}

export interface Meta {
  key: string;
  value: unknown;
}

export interface ReferenceCache {
  tenantId: string;
  data: ReferenceData;
  fetchedAt: string;
}

export interface ReferenceData {
  estates: { id: string; code: string; name: string; timeZone: string }[];
  fields: { id: string; estateId: string; code: string; name: string; crops: string[]; varietyIds: string[] }[];
  varieties: { id: string; code: string; name: string; crop: string }[];
  jobTypes: { id: string; code: string; name: string }[];
  workers: { id: string; estateId: string; employeeCode: string; name: string }[];
  logKinds: { id: string; code: string; label: string; unit: string | null; valueType: "NUMBER" | "TEXT"; decimals: number }[];
}

export class LocalDb extends Dexie {
  outbox!: EntityTable<OutboxItem, "mutationId">;
  records!: EntityTable<LocalRecord, "key">;
  meta!: EntityTable<Meta, "key">;
  reference!: EntityTable<ReferenceCache, "tenantId">;

  constructor(name = "cemms") {
    super(name);
    this.version(1).stores({
      outbox: "mutationId, [userId+status], createdAt, status",
      records: "key, [tenantId+entityType+estateId+businessDate], status",
      meta: "key",
      reference: "tenantId",
    });
  }
}

export const db = new LocalDb();

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await db.meta.get(key))?.value as T | undefined;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value });
}
