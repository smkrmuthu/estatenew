# ADR-0003: Identity and tenancy model (interim)

- Status: Interim. AQ-1 is a platform (product) decision for the platform owner, not a question for the estate owner (clarified 28 October 2026). This model is what the Glazebrooke go-live uses; cross-tenant login can be added later without changing token routing.
- Proposed default used: separate companies; one user belongs to one tenant; an Owner sees every estate in the tenant.

## Decision

- A user row belongs to exactly one tenant. Usernames are unique per tenant; sign-in names the tenant by its short code.
- Role grants are `(user, estate or tenant-wide, role)`. Platform Admin is not a tenant role and has no tenant data access without a time-limited, audited support grant (Phase 1B; not built yet, so platform staff have no tenant data access at all).
- The prototype's "Admin" maps to Owner (tenant-wide) or Estate Manager (one estate). "Supervisor" maps to Field Supervisor.
- If AQ-1 is answered "one login across several tenants", a membership table replaces `users.tenant_id`. The token already carries one tenant, so routing does not change.
