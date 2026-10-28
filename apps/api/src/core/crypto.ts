/** WebCrypto helpers: password hashing, tokens, JWT, TOTP and field encryption. */

const enc = new TextEncoder();
const dec = new TextDecoder();

export const PBKDF2_ITERATIONS = 600_000;

export function bytesToB64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function b64urlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const b64 = value
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(new ArrayBuffer(n)));
}

export function randomToken(bytes = 32): string {
  return bytesToB64url(randomBytes(bytes));
}

export async function sha256Hex(value: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", enc.encode(value));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time comparison of two strings. */
export function safeEqual(a: string, b: string): boolean {
  const x = enc.encode(a);
  const y = enc.encode(b);
  if (x.byteLength !== y.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < x.byteLength; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** Cloudflare's runtime refuses more than 100,000 PBKDF2 iterations in one call (local workerd does not). */
export const PBKDF2_MAX_PER_CALL = 100_000;
/** Six chained rounds give the 600,000-iteration cost of the baseline (ADR-0009). */
export const PBKDF2_ROUNDS = PBKDF2_ITERATIONS / PBKDF2_MAX_PER_CALL;

async function pbkdf2(secret: Uint8Array<ArrayBuffer>, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array<ArrayBuffer>> {
  // Enforce the production limit here so local tests fail the same way production would.
  if (iterations > PBKDF2_MAX_PER_CALL) throw new Error(`PBKDF2 iterations above ${PBKDF2_MAX_PER_CALL} per call are not supported`);
  const key = await crypto.subtle.importKey("raw", secret, "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

/** Round i (from 1) uses the previous round's output as its key and salt || i as its salt. */
async function chainedPbkdf2(password: string, salt: Uint8Array<ArrayBuffer>, rounds: number, perRound: number): Promise<Uint8Array> {
  const pw = enc.encode(password);
  let out = await pbkdf2(new Uint8Array(pw.buffer.slice(0, pw.byteLength) as ArrayBuffer), salt, perRound);
  for (let i = 1; i < rounds; i++) {
    const roundSalt = new Uint8Array(new ArrayBuffer(salt.byteLength + 1));
    roundSalt.set(salt);
    roundSalt[salt.byteLength] = i;
    out = await pbkdf2(out, roundSalt, perRound);
  }
  return out;
}

/** Stored as `pbkdf2-sha256x<rounds>$<iterations per round>$<salt>$<hash>`. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await chainedPbkdf2(password, salt, PBKDF2_ROUNDS, PBKDF2_MAX_PER_CALL);
  return `pbkdf2-sha256x${PBKDF2_ROUNDS}$${PBKDF2_MAX_PER_CALL}$${bytesToB64url(salt)}$${bytesToB64url(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iter, salt, hash] = stored.split("$");
  const m = /^pbkdf2-sha256x(\d{1,2})$/.exec(scheme ?? "");
  const perRound = Number(iter);
  if (!m || !salt || !hash || !Number.isSafeInteger(perRound) || perRound < 1 || perRound > PBKDF2_MAX_PER_CALL) return false;
  const rounds = Number(m[1]);
  if (rounds < 1 || rounds > 20) return false;
  const actual = await chainedPbkdf2(password, b64urlToBytes(salt), rounds, perRound);
  return safeEqual(bytesToB64url(actual), hash);
}

/** A real hash to compare against when the user does not exist, so timing does not reveal it. */
let dummyHash: Promise<string> | undefined;
export function dummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword(randomToken(16));
  return dummyHash;
}

// ---------- JWT (HS256) ----------

export interface AccessClaims {
  sub: string;
  tid: string;
  sid: string;
  did: string;
  iat: number;
  exp: number;
  iss: "cemms";
  aud: string;
}

async function hmacKey(secret: string, usage: Array<"sign" | "verify">): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, usage);
}

export async function signJwt(claims: AccessClaims, secret: string): Promise<string> {
  const head = bytesToB64url(enc.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = bytesToB64url(enc.encode(JSON.stringify(claims)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret, ["sign"]), enc.encode(`${head}.${body}`));
  return `${head}.${body}.${bytesToB64url(new Uint8Array(sig))}`;
}

export async function verifyJwt(token: string, secret: string, audience: string, nowSec = Math.floor(Date.now() / 1000)): Promise<AccessClaims | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [head, body, sig] = parts as [string, string, string];
  try {
    const header = JSON.parse(dec.decode(b64urlToBytes(head)));
    if (header.alg !== "HS256") return null;
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret, ["verify"]), b64urlToBytes(sig), enc.encode(`${head}.${body}`));
    if (!ok) return null;
    const claims = JSON.parse(dec.decode(b64urlToBytes(body))) as AccessClaims;
    if (claims.iss !== "cemms" || claims.aud !== audience) return null;
    if (typeof claims.exp !== "number" || claims.exp <= nowSec) return null;
    if (!claims.sub || !claims.tid || !claims.sid || !claims.did) return null;
    return claims;
  } catch {
    return null;
  }
}

// ---------- TOTP (RFC 6238, SHA-1, 6 digits, 30 s) ----------

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Uint8Array<ArrayBuffer> {
  const clean = text.replace(/=+$/, "").toUpperCase();
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error("bad base32");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  const bytes = new Uint8Array(new ArrayBuffer(out.length));
  bytes.set(out);
  return bytes;
}

export async function totpAt(secretB32: string, step: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", base32Decode(secretB32), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const counter = new ArrayBuffer(8);
  new DataView(counter).setBigUint64(0, BigInt(step));
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, counter));
  const offset = (mac[19] ?? 0) & 0xf;
  const code = (((mac[offset] ?? 0) & 0x7f) << 24) | ((mac[offset + 1] ?? 0) << 16) | ((mac[offset + 2] ?? 0) << 8) | (mac[offset + 3] ?? 0);
  return String(code % 1_000_000).padStart(6, "0");
}

/** Returns the matched time step (to block replay), or null. Accepts one step of clock drift. */
export async function verifyTotp(secretB32: string, code: string, lastUsedStep: number | null, nowMs = Date.now()): Promise<number | null> {
  const step = Math.floor(nowMs / 30_000);
  for (const s of [step - 1, step, step + 1]) {
    if (lastUsedStep !== null && s <= lastUsedStep) continue;
    if (safeEqual(await totpAt(secretB32, s), code)) return s;
  }
  return null;
}

// ---------- AES-GCM for secrets at rest ----------

async function aesKey(keyB64: string): Promise<CryptoKey> {
  const raw = Uint8Array.from(atob(keyB64), (c) => c.charCodeAt(0));
  if (raw.byteLength !== 32) throw new Error("MFA_ENC_KEY must be 32 bytes, base64 encoded");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptSecret(plain: string, keyB64: string): Promise<string> {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(keyB64), enc.encode(plain));
  return `${bytesToB64url(iv)}.${bytesToB64url(new Uint8Array(ct))}`;
}

export async function decryptSecret(value: string, keyB64: string): Promise<string> {
  const [iv, ct] = value.split(".");
  if (!iv || !ct) throw new Error("bad ciphertext");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64urlToBytes(iv) }, await aesKey(keyB64), b64urlToBytes(ct));
  return dec.decode(pt);
}
