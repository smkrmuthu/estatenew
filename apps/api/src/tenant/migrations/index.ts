import m0001 from "./0001_init";

/** Ordered tenant migrations. Append only. */
export const TENANT_MIGRATIONS: readonly { version: number; name: string; sql: string }[] = [{ version: 1, name: "init", sql: m0001 }];
