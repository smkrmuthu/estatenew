# Modules and Boundaries

Enforced by `npm run boundaries` (`scripts/check-boundaries.mjs`).

| Package | Contains | May import |
|---|---|---|
| `packages/domain` | Pure rules: weights in grams, attendance states, permissions, settings gates, CSV parsing, sync contract, ids, dates | Nothing outside itself |
| `packages/contracts` | Zod request and payload schemas shared by API and web | `@cemms/domain`, `zod` |
| `apps/api/src/routes` | HTTP routes (Hono): parse, call the tenant database, return JSON | `callTenant` and control-plane modules; never tenant modules directly |
| `apps/api/src/auth`, `src/control` | Sign-in, sessions, devices, users, tenant registry (D1) | domain, contracts, core |
| `apps/api/src/tenant` | The `TenantDb` Durable Object: migrations, operation dispatcher, modules (organization, imports, attendance, muster, dailylog, sync, reports, history, settings) | domain, contracts, core; never control or routes |
| `apps/web` | React PWA: screens, IndexedDB outbox, sync engine | domain, contracts; talks to the API over HTTP only |

Layering inside the API: route → `callTenant` (verified scope) → `TenantDb.run(op)` (input schema, tenant check) → module service (permission check, validation, transaction, audit, revision, outbox) → Drizzle repository calls.
