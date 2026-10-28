import m0001 from "./0001_init";
import m0002 from "./0002_worker_field_masters";
import m0003 from "./0003_worker_area_north_indian";
import m0004 from "./0004_worker_all_estates";
import m0005 from "./0005_attendance_shift";

/** Ordered tenant migrations. Append only. */
export const TENANT_MIGRATIONS: readonly { version: number; name: string; sql: string }[] = [
  { version: 1, name: "init", sql: m0001 },
  { version: 2, name: "worker_field_masters", sql: m0002 },
  { version: 3, name: "worker_area_north_indian", sql: m0003 },
  { version: 4, name: "worker_all_estates", sql: m0004 },
  { version: 5, name: "attendance_shift", sql: m0005 },
];
