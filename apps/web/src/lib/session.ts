import type { SessionResponse } from "@cemms/contracts";
import { uuidv7 } from "@cemms/domain";
import { getMeta, setMeta } from "./db";

/** What the phone keeps about the signed-in user. No tokens: only who, and until when. */
export interface StoredSession {
  tenantCode: string;
  user: SessionResponse["user"];
  sessionExpiresAt: string;
}

export async function deviceId(): Promise<string> {
  let id = await getMeta<string>("deviceId");
  if (!id) {
    id = uuidv7();
    await setMeta("deviceId", id);
  }
  return id;
}

export const loadSession = () => getMeta<StoredSession>("session");
export const saveSession = (s: StoredSession | null) => setMeta("session", s);

export function sessionUsable(s: StoredSession | undefined): s is StoredSession {
  return !!s && new Date(s.sessionExpiresAt).getTime() > Date.now();
}
