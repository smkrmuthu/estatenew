# ADR-0002: Repository and tooling

- Status: Accepted, 28 October 2026

## Decision

- npm workspaces (npm 11 is installed; pnpm is not). Packages: `packages/domain` (pure business rules, no I/O), `packages/contracts` (Zod schemas shared by API and web), `apps/api` (Worker), `apps/web` (PWA).
- TypeScript 6 in strict mode. Biome for lint and format.
- Tests: Vitest for pure packages; `@cloudflare/vitest-plugin` runs API tests inside workerd with real D1 and Durable Object SQLite.
- Module boundaries: `packages/domain` imports nothing from the apps; `apps/api` modules talk to each other only through services. A boundary check script enforces this in CI.
