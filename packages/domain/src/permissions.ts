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
  /** Add or change Daily log reading kinds, which every estate shares. Held on any estate. */
  "dailylog.configure",
  /** Change settings such as the season start and attendance types. Recording go-live answers stays with settings.manage (owner). */
  "settings.configure",
  "conflicts.resolve",
  "reports.read",
  "reports.workerDetail",
  "audit.read",
  "sync.push",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** Permissions that only make sense tenant-wide; they need a grant with no estate. */
export const TENANT_WIDE: ReadonlySet<Permission> = new Set(["settings.manage"]);

const READ: Permission[] = ["estate.read", "masters.read", "attendance.read", "muster.read", "dailylog.read", "reports.read"];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  // Platform staff have no tenant data access; support access needs a time-limited audited grant (not built).
  PLATFORM_ADMIN: [],
  OWNER: PERMISSIONS,
  // Managing users stays with the owner (project lead, 29 October 2026; reverses the 28 October grant to managers).
  ESTATE_MANAGER: PERMISSIONS.filter((p) => !TENANT_WIDE.has(p) && p !== "users.manage"),
  FIELD_SUPERVISOR: [...READ, "attendance.capture", "attendance.submit", "muster.capture", "dailylog.capture", "sync.push"],
  PROCESSING_OPERATOR: ["estate.read", "masters.read", "dailylog.read", "dailylog.capture", "sync.push"],
  QUALITY_OFFICER: ["estate.read", "masters.read", "dailylog.read"],
  PACKING_OPERATOR: ["estate.read", "masters.read"],
  AUDITOR: [...READ, "reports.workerDetail", "audit.read"],
};

/**
 * Roles that must use an authenticator app, by default: only the Owner (and platform staff).
 * Estate managers and field staff sign in with a password only (owner decision, 28 October 2026).
 * Each environment chooses which roles are enforced with the MFA_ROLES setting; production turns on OWNER.
 */
export const MFA_REQUIRED_ROLES: ReadonlySet<Role> = new Set(["PLATFORM_ADMIN", "OWNER"]);

/** Parse a comma separated role list (for example "OWNER,PLATFORM_ADMIN"). An empty value means no role is forced. */
export function parseMfaRoles(value: string | undefined): ReadonlySet<Role> {
  const out = new Set<Role>();
  for (const part of (value ?? "").split(",")) {
    const role = part.trim().toUpperCase();
    if ((ROLES as readonly string[]).includes(role)) out.add(role as Role);
  }
  return out;
}

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

/**
 * True when the role grants the permission on at least one estate (or tenant-wide). Used for lists every estate shares,
 * such as jobs, varieties and Daily log kinds, and for managing users.
 */
export function canAnyEstate(grants: readonly Grant[], permission: Permission): boolean {
  return grants.some((g) => ROLE_PERMISSIONS[g.role].includes(permission) && !(TENANT_WIDE.has(permission) && g.estateId !== null));
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

export function requiresMfa(grants: readonly Grant[], roles: ReadonlySet<Role> = MFA_REQUIRED_ROLES): boolean {
  return grants.some((g) => roles.has(g.role));
}
