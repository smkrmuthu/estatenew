import type { Context } from "hono";
import type { Scope } from "../tenant/context";
import type { RunResult, TenantDb, TenantOp, TenantOpResult } from "../tenant/tenant-db";
import { AppError, fromRpcError } from "./errors";
import type { AppEnv } from "./types";

export function tenantStub(env: Env, dbName: string): DurableObjectStub<TenantDb> {
  const ns = env.TENANT_DB as DurableObjectNamespace<TenantDb>;
  return ns.get(ns.idFromName(dbName), { locationHint: env.LOCATION_HINT as DurableObjectLocationHint });
}

/** Call the tenant database for the authenticated tenant only. */
export async function callTenant<K extends TenantOp>(c: Context<AppEnv>, op: K, input: unknown): Promise<TenantOpResult<K>> {
  const auth = c.get("auth");
  if (!auth) throw new AppError(401, "UNAUTHENTICATED", "Sign in again");
  const scope: Scope = {
    tenantId: auth.tenant.id,
    userId: auth.user.id,
    sessionId: auth.session.id,
    deviceId: auth.session.deviceId,
    grants: auth.grants,
    requestId: c.get("requestId"),
    environment: c.env.ENVIRONMENT,
  };
  const result = (await tenantStub(c.env, auth.tenant.dbName).run(scope, op, input)) as unknown as RunResult<TenantOpResult<K>>;
  if (!result.ok) throw fromRpcError(result.error) ?? new AppError(500, "INTERNAL", "Something went wrong");
  return result.value as TenantOpResult<K>;
}
