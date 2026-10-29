// Seeds a tenant with synthetic data (no real workers or figures).
// Local:   node apps/api/scripts/seed-dev.mjs                     (token from apps/api/.dev.vars, known demo passwords)
// Staging: node apps/api/scripts/seed-dev.mjs https://glazebrooke-staging.oneuptech.co apps/api/.secrets.staging.json \
//            --tenant glazebrooke --name "Glazebrooke Estates" --domain glazebrooke-staging.oneuptech.co --estates "GLZ:Glazebrooke,BYV:Byson Valley"
//          (random passwords, written with the authenticator secret to apps/api/.secrets.staging-<tenant>-users.json, mode 600)
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const flag = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const positional = process.argv.slice(2).filter((a, i, all) => !a.startsWith("--") && !all[i - 1]?.startsWith("--"));
const base = positional[0] ?? "http://localhost:8787";
const secretsPath = positional[1];
const local = base.includes("localhost");
const vars = secretsPath
  ? JSON.parse(readFileSync(secretsPath, "utf8"))
  : Object.fromEntries(
      readFileSync(new URL("../.dev.vars", import.meta.url), "utf8")
        .split("\n")
        .filter((l) => l && !l.startsWith("#"))
        .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
    );
const origin = local ? "http://localhost:5173" : base;
const tenant = flag("tenant", "demo");
const tenantName = flag("name", "Demo Estates (synthetic)");
const domain = flag("domain");
const estates = flag("estates", "EST1:North Estate,EST2:South Estate")
  .split(",")
  .map((p) => p.split(":"));
const usersFile = new URL(`../.secrets.staging-${tenant}-users.json`, import.meta.url);
const randomPassword = () => Buffer.from(crypto.getRandomValues(new Uint8Array(18))).toString("base64url");
const saved = !local && existsSync(usersFile) ? JSON.parse(readFileSync(usersFile, "utf8")) : {};
const call = async (path, { body, token, headers = {} } = {}) => {
  const res = await fetch(`${base}/api/v1${path}`, {
    method: body ? "POST" : "GET",
    headers: { origin, ...(body ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path}: ${res.status} ${JSON.stringify(json)}`);
  return json;
};

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function b32decode(s) {
  let bits = 0,
    value = 0;
  const out = [];
  for (const ch of s) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}
async function totp(secret) {
  const key = await crypto.subtle.importKey("raw", b32decode(secret), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const counter = new ArrayBuffer(8);
  new DataView(counter).setBigUint64(0, BigInt(Math.floor(Date.now() / 30000)));
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, counter));
  const o = mac[19] & 15;
  return String((((mac[o] & 127) << 24) | (mac[o + 1] << 16) | (mac[o + 2] << 8) | mac[o + 3]) % 1e6).padStart(6, "0");
}

const ownerPassword = local ? "demo-owner-password" : (saved.ownerPassword ?? randomPassword());
const supervisorPassword = local ? "demo-supervisor-1" : (saved.supervisorPassword ?? randomPassword());
// One device id per tenant (a device belongs to one tenant).
const uuidv7 = () => {
  const b = crypto.getRandomValues(new Uint8Array(16));
  let t = Date.now();
  for (let i = 5; i >= 0; i--) {
    b[i] = t & 255;
    t = Math.floor(t / 256);
  }
  b[6] = (b[6] & 15) | 112;
  b[8] = (b[8] & 63) | 128;
  const h = Buffer.from(b).toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};
const deviceId = local && tenant === "demo" ? "01a18000-0000-7000-8000-00000000d001" : (saved.deviceId ?? uuidv7());
const persist = (extra = {}) => {
  if (!local) writeFileSync(usersFile, JSON.stringify({ ...saved, base, tenant, ownerPassword, supervisorPassword, deviceId, ...extra }, null, 2), { mode: 0o600 });
};
// Save the generated passwords before anything is created, so a failed run can be repeated.
persist();
try {
  await call("/platform/tenants", {
    body: { code: tenant, name: tenantName, owner: { username: "owner", displayName: "Owner", password: ownerPassword }, ...(domain ? { domains: [domain] } : {}) },
    headers: { "x-platform-token": vars.PLATFORM_BOOTSTRAP_TOKEN },
  });
} catch (e) {
  if (!String(e).includes("CODE_TAKEN") && !String(e).includes("DOMAIN_TAKEN")) throw e;
}
const first = await call("/auth/login", { body: { tenant, username: "owner", password: ownerPassword, deviceId } });
let token = first.accessToken;
const secret = first.secret ?? saved.ownerAuthenticatorSecret;
if (first.secret) persist({ ownerAuthenticatorSecret: first.secret });
if (!token) {
  if (!secret) throw new Error("Owner already enrolled in MFA; reset local state (rm -rf apps/api/.wrangler) to reseed.");
  token = (await call("/auth/login", { body: { tenant, username: "owner", password: ownerPassword, deviceId, totp: await totp(secret) } })).accessToken;
}
const imp = async (kind, rows) => {
  const csv = `${rows.join("\n")}\n`;
  const pre = await call("/imports/preview", { token, body: { kind, csv } });
  if (pre.errors.length) throw new Error(`${kind}: ${JSON.stringify(pre.errors)}`);
  await call("/imports/commit", { token, body: { kind, csv, previewHash: pre.previewHash } });
};
await imp("estates", ["code,name", ...estates.map(([code, name]) => `${code},${name}`)]);
const [e1, e2] = estates.map(([code]) => code);
await imp("varieties", ["code,name,crop", "VAR1,Arabica Sample,COFFEE", "VAR2,Robusta Sample,COFFEE", "PEP1,Pepper Sample,PEPPER"]);
// The plucking job is flagged (the CSV import does not carry the flag), so the Plucking page knows who is expected at the evening muster.
await call("/job-types", { token, body: { code: "PLK", name: "Plucking", countsAsPlucking: true, active: true } }).catch((e) => {
  if (!String(e).includes("409")) throw e;
});
await imp("job_types", ["code,name", "PRN,Pruning", "WED,Weeding"]);
await imp("fields", [
  "estate_code,code,name,area_acres,crops,varieties",
  `${e1},N1,Block 1,10,COFFEE;PEPPER,VAR1;PEP1`,
  `${e1},N2,Block 2,6.5,COFFEE,VAR2`,
  `${e2},S1,Block 1,8,COFFEE;PEPPER,VAR1;PEP1`,
]);
await imp("workers", [
  "estate_code,employee_code,name",
  ...Array.from({ length: 12 }, (_, i) => `${e1},N${String(i + 1).padStart(3, "0")},Worker ${String.fromCharCode(65 + i)}`),
  ...Array.from({ length: 6 }, (_, i) => `${e2},S${String(i + 1).padStart(3, "0")},Worker S${i + 1}`),
]);
const kinds = (await call("/reference", { token })).logKinds;
if (!kinds.length) {
  // Development fixture only: the real reading list is still open with the owner (OC-100).
  await call("/admin/log-kinds", { token, body: { code: "TEMP", label: "Temperature", unit: "°C", valueType: "NUMBER", decimals: 1, minScaled: -100, maxScaled: 600 } });
  await call("/admin/log-kinds", { token, body: { code: "RAIN", label: "Rain", unit: "mm", valueType: "NUMBER", decimals: 1, minScaled: 0, maxScaled: 5000 } });
}
const ref = await call("/reference", { token });
const est1 = ref.estates.find((e) => e.code === e1);
try {
  await call("/admin/users", { token, body: { username: "sup1", displayName: "Test Supervisor", password: supervisorPassword, grants: [{ role: "FIELD_SUPERVISOR", estateId: est1.id }] } });
} catch (e) {
  if (!String(e).includes("USERNAME_TAKEN")) throw e;
}
if (local) {
  console.log(`Seeded tenant "${tenant}". Supervisor sign-in: demo / sup1 / ${supervisorPassword}. Owner: demo / owner / ${ownerPassword} (authenticator secret ${secret ?? "already enrolled"}).`);
} else {
  writeFileSync(usersFile, JSON.stringify({ base, tenant, ownerPassword, ownerAuthenticatorSecret: secret ?? saved.ownerAuthenticatorSecret, supervisorPassword }, null, 2), { mode: 0o600 });
  console.log(`Seeded tenant "${tenant}" on ${base}. Sign-ins and the owner's authenticator secret are in apps/api/.secrets.staging-${tenant}-users.json.`);
}
