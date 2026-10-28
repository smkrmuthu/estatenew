import type { SessionResponse } from "@cemms/contracts";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fieldErrors?: Record<string, string>,
  ) {
    super(message);
  }
}

/** The access token lives only in memory (never in IndexedDB or localStorage). */
let accessToken: string | null = null;
let accessExpires = 0;
let refreshing: Promise<SessionResponse | null> | null = null;
const listeners = new Set<(s: SessionResponse | null) => void>();

export function setAccess(session: SessionResponse | null) {
  accessToken = session?.accessToken ?? null;
  accessExpires = session ? new Date(session.expiresAt).getTime() : 0;
  for (const l of listeners) l(session);
}

export function onSessionChange(fn: (s: SessionResponse | null) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const hasAccess = () => accessToken !== null && Date.now() < accessExpires - 30_000;

async function parse(res: Response) {
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, body?.code ?? "HTTP_ERROR", body?.title ?? `Request failed (${res.status})`, body?.fieldErrors);
  return body;
}

/** Use the httpOnly refresh cookie to get a new access token. Single flight. */
export function refreshAccess(): Promise<SessionResponse | null> {
  refreshing ??= fetch("/api/v1/auth/refresh", { method: "POST", credentials: "same-origin", headers: { "x-cemms-csrf": "1" } })
    .then(async (res) => {
      if (res.status === 401 || res.status === 403) {
        setAccess(null);
        return null;
      }
      const s = (await parse(res)) as SessionResponse;
      setAccess(s);
      return s;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<T> {
  if (!hasAccess()) await refreshAccess();
  const go = () =>
    fetch(`/api/v1${path}`, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      credentials: "same-origin",
      headers: { ...(init.body !== undefined ? { "content-type": "application/json" } : {}), ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}), ...(init.headers ?? {}) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  let res = await go();
  if (res.status === 401 && (await refreshAccess())) res = await go();
  return (await parse(res)) as T;
}

export async function signIn(body: { tenant: string; username: string; password: string; deviceId: string; deviceLabel?: string; totp?: string }) {
  const res = await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await parse(res);
  if (data?.accessToken) setAccess(data as SessionResponse);
  return data as SessionResponse | { mfa: "required" | "enrol"; secret?: string; otpauthUri?: string };
}

export async function signOut() {
  try {
    if (hasAccess()) await fetch("/api/v1/auth/logout", { method: "POST", credentials: "same-origin", headers: { authorization: `Bearer ${accessToken}`, "x-cemms-csrf": "1" } });
  } finally {
    setAccess(null);
  }
}
