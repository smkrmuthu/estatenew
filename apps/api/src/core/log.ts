/** Structured JSON logs. Credentials, tokens and worker personal data are never logged. */
const REDACT = /pass(word)?|token|secret|authorization|cookie|totp|otp|name|csv|payload|remarks/i;

export type LogFields = Record<string, unknown>;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = REDACT.test(k) ? "[redacted]" : redact(v, depth + 1);
  return out;
}

export function log(level: "debug" | "info" | "warn" | "error", message: string, fields: LogFields = {}): void {
  const line = JSON.stringify({ level, message, at: new Date().toISOString(), ...(redact(fields) as LogFields) });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}
