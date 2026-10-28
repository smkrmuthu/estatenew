import { uuidv7 } from "@cemms/domain";
import type { Context, MiddlewareHandler } from "hono";
import { AppError } from "./errors";
import type { AppEnv } from "./types";

export const MAX_JSON_BYTES = 1_200_000;

export const requestId: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set("requestId", uuidv7());
  await next();
  c.header("x-request-id", c.get("requestId"));
};

/** API responses are JSON only: lock down everything a browser could do with them. */
export const securityHeaders: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next();
  c.header("strict-transport-security", "max-age=31536000; includeSubDomains");
  c.header("x-content-type-options", "nosniff");
  c.header("x-frame-options", "DENY");
  c.header("referrer-policy", "no-referrer");
  c.header("content-security-policy", "default-src 'none'; frame-ancestors 'none'");
  c.header("permissions-policy", "camera=(), microphone=(), geolocation=()");
  c.header("cross-origin-resource-policy", "same-origin");
  if (!c.res.headers.has("cache-control")) c.header("cache-control", "no-store");
};

/**
 * The web app is served from the same origin as the API, so cross-origin browser calls are
 * refused outright. Requests without an Origin header (non-browser clients) still need a token.
 */
export const sameOriginOnly: MiddlewareHandler<AppEnv> = async (c, next) => {
  const origin = c.req.header("origin");
  if (origin && origin !== c.env.APP_ORIGIN && origin !== new URL(c.req.url).origin) throw new AppError(403, "ORIGIN_REFUSED", "Requests from other sites are not allowed");
  if (c.req.method === "OPTIONS") return c.body(null, 204);
  await next();
};

export async function readJson(c: Context<AppEnv>): Promise<unknown> {
  const len = Number(c.req.header("content-length") ?? "0");
  if (len > MAX_JSON_BYTES) throw new AppError(413, "BODY_TOO_LARGE", "The request is too large");
  const text = await c.req.text();
  if (text.length > MAX_JSON_BYTES) throw new AppError(413, "BODY_TOO_LARGE", "The request is too large");
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError(400, "BAD_JSON", "The request body is not valid JSON");
  }
}

export function rateLimit(binding: "LOGIN_LIMIT" | "API_LIMIT", keyOf: (c: Context<AppEnv>) => string): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const limiter = c.env[binding];
    if (limiter) {
      const { success } = await limiter.limit({ key: keyOf(c) });
      if (!success) {
        c.header("retry-after", "60");
        throw new AppError(429, "RATE_LIMITED", "Too many requests. Wait a minute and try again.");
      }
    }
    await next();
  };
}

export const clientIp = (c: Context<AppEnv>) => c.req.header("cf-connecting-ip") ?? "local";
