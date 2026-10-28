import { exports } from "cloudflare:workers";
import { canonicalJson, SYNC_SCHEMA_VERSION, sha256Hex, uuidv7 } from "@cemms/domain";
import { expect } from "vitest";
import { totpAt } from "../src/core/crypto";

export const BOOTSTRAP = "test-only-platform-bootstrap-token-0123456789";
export const ORIGIN = "http://localhost:5173";

export interface Res<T = any> {
  status: number;
  body: T;
  headers: Headers;
}

export async function api<T = any>(path: string, init: { method?: string; body?: unknown; token?: string; headers?: Record<string, string>; cookie?: string; host?: string } = {}): Promise<Res<T>> {
  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  if (init.body !== undefined) headers["content-type"] = "application/json";
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  if (init.cookie) headers.cookie = init.cookie;
  // Each call looks like its own client so the per-IP sign-in limit does not trip between tests.
  headers["cf-connecting-ip"] ??= `10.${counter % 250}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
  const res = await exports.default.fetch(
    new Request(`http://${init.host ?? "localhost"}/api/v1${path}`, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }),
  );
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {}
  return { status: res.status, body: body as T, headers: res.headers };
}

export function cookieFrom(res: Res): string {
  const raw = res.headers.get("set-cookie") ?? "";
  const m = /cemms_rt=([^;]+)/.exec(raw);
  return m ? `cemms_rt=${m[1]}` : "";
}

let counter = 0;
export const uniq = (p: string) => `${p}${Date.now().toString(36)}${(counter++).toString(36)}`;

export async function createTenant(code = uniq("t"), seedGatesFromRegister = false) {
  const owner = { username: "owner", displayName: "Test Owner", password: "owner-password-123" };
  const res = await api("/platform/tenants", { body: { code, name: `Tenant ${code}`, owner, seedGatesFromRegister }, headers: { "x-platform-token": BOOTSTRAP } });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return { code, tenantId: res.body.tenantId as string, owner };
}

export async function login(tenant: string, username: string, password: string, deviceId = uuidv7()) {
  let res = await api("/auth/login", { body: { tenant, username, password, deviceId } });
  if (res.body?.mfa === "enrol" || res.body?.mfa === "required") {
    const secret = res.body.secret ?? (await mfaSecrets.get(`${tenant}/${username}`));
    if (res.body.secret) mfaSecrets.set(`${tenant}/${username}`, res.body.secret);
    let step = Math.floor(Date.now() / 30_000);
    const used = lastStep.get(`${tenant}/${username}`) ?? -1;
    if (step <= used) step = used + 1;
    lastStep.set(`${tenant}/${username}`, step);
    res = await api("/auth/login", { body: { tenant, username, password, deviceId, totp: await totpAt(secret as string, step) } });
  }
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return { token: res.body.accessToken as string, user: res.body.user, cookie: cookieFrom(res), deviceId };
}
const mfaSecrets = new Map<string, string>();
const lastStep = new Map<string, number>();

/** A tenant with one estate, two fields (one coffee-only, one coffee+pepper), jobs, workers and a supervisor. */
export async function setupTenant() {
  const t = await createTenant();
  const owner = await login(t.code, "owner", t.owner.password);
  const estate = (await api("/estates", { token: owner.token, body: { code: "GLZ", name: "Estate One" } })).body;
  const estate2 = (await api("/estates", { token: owner.token, body: { code: "BYV", name: "Estate Two" } })).body;
  const csv = (rows: string[]) => `${rows.join("\n")}\n`;
  const imp = async (kind: string, rows: string[]) => {
    const text = csv(rows);
    const pre = await api("/imports/preview", { token: owner.token, body: { kind, csv: text } });
    expect(pre.body.errors, JSON.stringify(pre.body)).toEqual([]);
    const done = await api("/imports/commit", { token: owner.token, body: { kind, csv: text, previewHash: pre.body.previewHash } });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    return done.body;
  };
  await imp("varieties", ["code,name,crop", "CG,Chandana Giri,COFFEE", "S9,Selection 9,COFFEE", "PNL,Panniyur,PEPPER"]);
  await imp("job_types", ["code,name", "PLK,Plucking", "WED,Weeding"]);
  await imp("fields", ["estate_code,code,name,area_acres,crops,varieties", "GLZ,F1,Field One,10.5,COFFEE,CG;S9", "GLZ,F2,Field Two,4,COFFEE;PEPPER,", "BYV,B1,Other Field,3,COFFEE,"]);
  await imp("workers", ["estate_code,employee_code,name", "GLZ,W001,Worker A", "GLZ,W002,Worker B", "GLZ,W003,Worker C", "BYV,W101,Worker D"]);
  const ref = (await api("/reference", { token: owner.token })).body;
  const sup = await api("/admin/users", {
    token: owner.token,
    body: { username: "sup1", displayName: "Supervisor One", password: "supervisor-pass-1", grants: [{ role: "FIELD_SUPERVISOR", estateId: estate.id }] },
  });
  expect(sup.status, JSON.stringify(sup.body)).toBe(201);
  const supervisor = await login(t.code, "sup1", "supervisor-pass-1");
  const pick = (list: any[], key: string, value: string) => list.find((x) => x[key] === value);
  return {
    ...t,
    owner,
    supervisor,
    estate,
    estate2,
    ref,
    f1: pick(ref.fields, "code", "F1"),
    f2: pick(ref.fields, "code", "F2"),
    b1: pick(ref.fields, "code", "B1"),
    plk: pick(ref.jobTypes, "code", "PLK"),
    w1: pick(ref.workers, "employeeCode", "W001"),
    w2: pick(ref.workers, "employeeCode", "W002"),
    w3: pick(ref.workers, "employeeCode", "W003"),
    w101: pick(ref.workers, "employeeCode", "W101"),
    cg: pick(ref.varieties, "code", "CG"),
    pnl: pick(ref.varieties, "code", "PNL"),
  };
}

export const today = (tz = "Asia/Kolkata") => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

export async function mutation(
  deviceId: string,
  estateId: string,
  entityType: string,
  op: string,
  payload: unknown,
  opts: { entityId?: string; baseVersion?: number; capturedAt?: string; mutationId?: string } = {},
) {
  return {
    mutationId: opts.mutationId ?? uuidv7(),
    entityType,
    entityId: opts.entityId ?? uuidv7(),
    op,
    estateId,
    deviceId,
    schemaVersion: SYNC_SCHEMA_VERSION,
    capturedAt: opts.capturedAt ?? new Date().toISOString(),
    baseVersion: opts.baseVersion ?? 0,
    payload,
    payloadHash: await sha256Hex(canonicalJson(payload)),
  };
}

export async function push(session: { token: string; deviceId: string }, mutations: unknown[], pendingCount = 0) {
  return api("/sync/push", { token: session.token, body: { deviceId: session.deviceId, pendingCount, mutations } });
}
