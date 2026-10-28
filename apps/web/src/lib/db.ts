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

export type Gender = "MALE" | "FEMALE";
export type EmploymentType = "PERMANENT" | "CASUAL" | "CONTRACT" | "NORTH_INDIAN";
export type LandUse = "BEARING" | "YOUNG" | "ROCK" | "WATER" | "EMPTY" | "OTHER_CROP";

export interface ReferenceData {
  estates: { id: string; code: string; name: string; timeZone: string }[];
  fields: {
    id: string;
    estateId: string;
    code: string;
    name: string;
    crops: string[];
    varietyIds: string[];
    areaCentiAcres?: number | null;
    elevationM?: number | null;
    expectedCherryKg?: number | null;
    active?: boolean;
    version?: number;
    subdivisions?: { id: string; label: string; landUse: LandUse; varietyId: string | null; areaCentiAcres: number | null }[];
  }[];
  varieties: { id: string; code: string; name: string; crop: string }[];
  jobTypes: { id: string; code: string; name: string; countsAsPlucking?: boolean; active?: boolean; version?: number }[];
  workers: {
    id: string;
    estateId: string;
    employeeCode: string;
    name: string;
    gender?: Gender | null;
    employmentType?: EmploymentType | null;
    area?: string | null;
    active?: boolean;
    version?: number;
  }[];
  logKinds: {
    id: string;
    code: string;
    label: string;
    unit: string | null;
    valueType: "NUMBER" | "TEXT";
    decimals: number;
    minScaled?: number | null;
    maxScaled?: number | null;
    expectedPerDay?: number | null;
    active?: boolean;
    version?: number;
  }[];
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
