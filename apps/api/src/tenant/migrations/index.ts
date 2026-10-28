import m0001 from "./0001_init";
import m0002 from "./0002_worker_field_masters";

/** Ordered tenant migrations. Append only. */
export const TENANT_MIGRATIONS: readonly { version: number; name: string; sql: string }[] = [
  { version: 1, name: "init", sql: m0001 },
  { version: 2, name: "worker_field_masters", sql: m0002 },
];
