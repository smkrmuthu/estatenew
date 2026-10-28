import type { Context } from "hono";
import { ZodError } from "zod";

export class AppError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 412 | 413 | 422 | 423 | 429 | 500 | 503,
    readonly code: string,
    message: string,
    readonly fieldErrors?: Record<string, string>,
  ) {
    super(message);
  }
}

export const unauthorized = (message = "Sign in again") => new AppError(401, "UNAUTHENTICATED", message);
export const forbidden = (message = "You do not have permission to do this") => new AppError(403, "FORBIDDEN", message);
export const notFound = (what = "Record") => new AppError(404, "NOT_FOUND", `${what} not found`);

export function fieldErrorsFromZod(error: ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    out[key] ??= issue.message;
  }
  return out;
}

/** Serialise an error as RFC 9457 problem details; never leak internals. */
export function problemResponse(c: Context, err: unknown): Response {
  const requestId = c.get("requestId" as never) as string | undefined;
  if (err instanceof AppError) {
    return c.json({ type: "about:blank", title: err.message, status: err.status, code: err.code, ...(err.fieldErrors ? { fieldErrors: err.fieldErrors } : {}), requestId }, err.status, {
      "content-type": "application/problem+json",
    });
  }
  if (err instanceof ZodError) {
    return c.json({ type: "about:blank", title: "Some values are not valid", status: 422, code: "VALIDATION", fieldErrors: fieldErrorsFromZod(err), requestId }, 422, {
      "content-type": "application/problem+json",
    });
  }
  return c.json({ type: "about:blank", title: "Something went wrong", status: 500, code: "INTERNAL", requestId }, 500, { "content-type": "application/problem+json" });
}

/** Errors thrown inside the tenant Durable Object cross RPC as plain objects. */
export interface RpcError {
  __appError: true;
  status: AppError["status"];
  code: string;
  message: string;
  fieldErrors?: Record<string, string>;
}

export function toRpcError(err: unknown): RpcError | null {
  if (err instanceof AppError) return { __appError: true, status: err.status, code: err.code, message: err.message, ...(err.fieldErrors ? { fieldErrors: err.fieldErrors } : {}) };
  if (err instanceof ZodError) return { __appError: true, status: 422, code: "VALIDATION", message: "Some values are not valid", fieldErrors: fieldErrorsFromZod(err) };
  return null;
}

export function fromRpcError(value: unknown): AppError | null {
  if (value && typeof value === "object" && (value as RpcError).__appError) {
    const e = value as RpcError;
    return new AppError(e.status, e.code, e.message, e.fieldErrors);
  }
  return null;
}
