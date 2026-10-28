/** Least-privilege, estate-scoped roles and permissions (Phase 1A set). */

export const ROLES = ["PLATFORM_ADMIN", "OWNER", "ESTATE_MANAGER", "FIELD_SUPERVISOR", "PROCESSING_OPERATOR", "QUALITY_OFFICER", "PACKING_OPERATOR", "AUDITOR"] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  "estate.read",
  "masters.read",
  "masters.write",
  "masters.import",
  "users.manage",
  "settings.manage",
  "attendance.read",
  "attendance.capture",
  "attendance.submit",
  "attendance.approve",
  "attendance.correct",
  "muster.read",
  "muster.capture",
  "muster.correct",
  "dailylog.read",
  "dailylog.capture",
  "dailylog.correct",
  "conflicts.resolve",
  "reports.read",
  "reports.workerDetail",
  "audit.read",
  "sync.push",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** Permissions that only make sense tenant-wide; they need a grant with no estate. */
export const TENANT_WIDE: ReadonlySet<Permission> = new Set(["users.manage", "settings.manage"]);

const READ: Permission[] = ["estate.read", "masters.read", "attendance.read", "muster.read", "dailylog.read", "reports.read"];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  // Platform staff have no tenant data access; support access needs a time-limited audited grant (not built).
  PLATFORM_ADMIN: [],
  OWNER: PERMISSIONS,
  ESTATE_MANAGER: PERMISSIONS.filter((p) => !TENANT_WIDE.has(p)),
  FIELD_SUPERVISOR: [...READ, "attendance.capture", "attendance.submit", "muster.capture", "dailylog.capture", "sync.push"],
  PROCESSING_OPERATOR: ["estate.read", "masters.read", "dailylog.read", "dailylog.capture", "sync.push"],
  QUALITY_OFFICER: ["estate.read", "masters.read", "dailylog.read"],
  PACKING_OPERATOR: ["estate.read", "masters.read"],
  AUDITOR: [...READ, "reports.workerDetail", "audit.read"],
};

/** Roles that must use multi-factor sign-in. */
export const MFA_REQUIRED_ROLES: ReadonlySet<Role> = new Set(["PLATFORM_ADMIN", "OWNER", "ESTATE_MANAGER"]);

export interface Grant {
  role: Role;
  /** null means tenant-wide. */
  estateId: string | null;
}

export function can(grants: readonly Grant[], permission: Permission, estateId: string | null): boolean {
  for (const g of grants) {
    if (!ROLE_PERMISSIONS[g.role].includes(permission)) continue;
    if (TENANT_WIDE.has(permission)) {
      if (g.estateId === null) return true;
      continue;
    }
    if (g.estateId === null) return true;
    if (estateId !== null && g.estateId === estateId) return true;
  }
  return false;
}

/** Estates a user may act on for a permission; "ALL" when a tenant-wide grant allows it. */
export function estatesWith(grants: readonly Grant[], permission: Permission): "ALL" | string[] {
  const ids = new Set<string>();
  for (const g of grants) {
    if (!ROLE_PERMISSIONS[g.role].includes(permission)) continue;
    if (g.estateId === null) return "ALL";
    ids.add(g.estateId);
  }
  return [...ids];
}

export function requiresMfa(grants: readonly Grant[]): boolean {
  return grants.some((g) => MFA_REQUIRED_ROLES.has(g.role));
}
