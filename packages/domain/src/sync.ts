/** Offline sync contract shared by the PWA and the API (ADR-0006). */

export const SYNC_SCHEMA_VERSION = 1;
export const MAX_SYNC_BATCH = 100;

export const SYNC_ENTITY_TYPES = ["attendance_record", "attendance_sheet", "muster_entry", "dailylog_entry"] as const;
export type SyncEntityType = (typeof SYNC_ENTITY_TYPES)[number];

export type SyncOp = "upsert" | "create" | "submit" | "void";

export interface MutationEnvelope<P = unknown> {
  mutationId: string;
  entityType: SyncEntityType;
  entityId: string;
  op: SyncOp;
  estateId: string;
  deviceId: string;
  schemaVersion: number;
  capturedAt: string;
  /** Server version the change was based on, for optimistic checks; 0 for new records. */
  baseVersion: number;
  payload: P;
  payloadHash: string;
}

export type SyncItemStatus = "accepted" | "rejected" | "conflict";

export interface SyncItemResult {
  mutationId: string;
  status: SyncItemStatus;
  entityId: string;
  /** Version after the change (accepted) or the server's current version (conflict). */
  version: number | null;
  serverTime: string;
  errorCode?: string;
  message?: string;
  fieldErrors?: Record<string, string>;
  conflictId?: string;
  duplicate?: boolean;
  /** True when the failure was temporary and the device should send the same mutation again. */
  retryable?: boolean;
}

/** Retry delay with full jitter: random between 0 and min(cap, base * 2^attempt). */
export function backoffMs(attempt: number, random: () => number = Math.random, baseMs = 2000, capMs = 5 * 60_000): number {
  const ceiling = Math.min(capMs, baseMs * 2 ** Math.max(0, attempt));
  return Math.floor(random() * ceiling);
}

/** Canonical JSON (sorted keys) so the client and server hash the same bytes. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    .join(",")}}`;
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
