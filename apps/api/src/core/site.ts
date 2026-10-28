import { eq } from "drizzle-orm";
import type { Context } from "hono";
import { controlDb } from "../control/db";
import { tenantDomains, tenants } from "../control/schema";
import type { AppEnv } from "./types";

/** The origin the browser used (scheme, host and port). Tokens are bound to it. */
export const siteOrigin = (c: Context<AppEnv>) => new URL(c.req.url).origin;

export const DOMAIN_PATTERN = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** The tenant that owns this site address, if any. Generic addresses (localhost) map to none. */
export async function tenantForHost(env: Env, url: string) {
  const host = new URL(url).hostname.toLowerCase();
  const row = await controlDb(env).select({ tenant: tenants }).from(tenantDomains).innerJoin(tenants, eq(tenants.id, tenantDomains.tenantId)).where(eq(tenantDomains.domain, host)).get();
  return row?.tenant ?? null;
}
