import type { Context, Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "./types";

export interface RouteDoc {
  method: "get" | "post" | "put";
  path: string;
  summary: string;
  tag: string;
  auth: "bearer" | "refresh-cookie" | "platform-token" | "none";
  permission?: string;
  body?: z.ZodType;
}

export const ROUTES: RouteDoc[] = [];

type Handler = (c: Context<AppEnv>) => Promise<Response> | Response;

/** Register a route on the app and in the OpenAPI document at the same time. */
export function route(app: Hono<AppEnv>, doc: RouteDoc, handler: Handler): void {
  ROUTES.push(doc);
  app[doc.method](doc.path, handler);
}

function jsonSchema(schema: z.ZodType | undefined): unknown {
  if (!schema) return undefined;
  try {
    return z.toJSONSchema(schema, { unrepresentable: "any", io: "input" });
  } catch {
    return { type: "object" };
  }
}

export function openApiDocument(base = "/api/v1") {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const r of ROUTES) {
    const p = base + r.path.replace(/:(\w+)/g, "{$1}");
    paths[p] ??= {};
    const params = [...r.path.matchAll(/:(\w+)/g)].map((m) => ({ name: m[1], in: "path", required: true, schema: { type: "string" } }));
    paths[p][r.method] = {
      summary: r.summary,
      tags: [r.tag],
      ...(r.permission ? { description: `Requires permission \`${r.permission}\` on the estate in scope.` } : {}),
      ...(params.length ? { parameters: params } : {}),
      ...(r.body ? { requestBody: { required: true, content: { "application/json": { schema: jsonSchema(r.body) } } } } : {}),
      security: r.auth === "bearer" ? [{ bearer: [] }] : r.auth === "platform-token" ? [{ platformToken: [] }] : r.auth === "refresh-cookie" ? [{ refreshCookie: [] }] : [],
      responses: { "200": { description: "OK" }, default: { description: "Problem details (RFC 9457)", content: { "application/problem+json": {} } } },
    };
  }
  return {
    openapi: "3.1.0",
    info: { title: "CEMMS API", version: "0.1.0", description: "Coffee Estate Management and Operations System. Tenant comes from the access token, never from the request." },
    components: {
      securitySchemes: {
        bearer: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
        refreshCookie: { type: "apiKey", in: "cookie", name: "cemms_rt" },
        platformToken: { type: "apiKey", in: "header", name: "x-platform-token" },
      },
    },
    paths,
  };
}
