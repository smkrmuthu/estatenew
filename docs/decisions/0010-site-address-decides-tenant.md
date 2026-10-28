# ADR-0010: The site address decides the tenant

- Status: Accepted
- Source: Project owner, 28 October 2026 ("create glazebrooke-staging.oneuptech.co … go live on glazebrooke.oneuptech.co … make the estate code fixed")

## Decision

- Each tenant is reached on its own address. Glazebrooke: `glazebrooke-staging.oneuptech.co` (staging, all new features first) and `glazebrooke.oneuptech.co` (production, after validation).
- The control database maps addresses to tenants (`tenant_domains`). On a mapped address the sign-in screen shows the tenant's name and asks only for user name and password; the server takes the tenant from the address and ignores nothing else (a different group code sent on that address is refused).
- On an unmapped address (local development) the group code field is still shown, so the multi-tenant design is unchanged.
- Access tokens are bound to the site origin (JWT audience), so a token issued on one tenant's address does not work on another's. Refresh also checks that the session's tenant owns the address.
- A device belongs to one tenant; signing in to another tenant on the same browser is refused with a clear message.

## Scalability

- One deployment serves every tenant. A new tenant is data: `POST /api/v1/platform/tenants` (with `domains`) creates the registry rows and its own SQLite database at runtime.
- The only per-tenant deployment step today is attaching the new address (one custom domain on `cemms-web-<env>` and one `/api/*` route on `cemms-api-<env>`). To remove even that, a later option is a wildcard address such as `*.estate.oneuptech.co` with a proxied wildcard DNS record; the `tenant_domains` lookup already supports it.
- Nothing in the code is specific to Glazebrooke; its name, estates and settings are tenant data.

## Staging and production

- Staging: Workers `cemms-api-staging`, `cemms-web-staging`; tenant `glazebrooke` (synthetic workers and fields; estate names Glazebrooke and Byson Valley).
- Production: configured for `glazebrooke.oneuptech.co`; resources not created until the go-ahead after staging validation.
- The earlier `estate-staging.oneuptech.co` address was detached; the synthetic `demo` tenant remains in staging data without an address.
