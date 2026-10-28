# Local Development

```bash
npm install
cp apps/api/.dev.vars.example apps/api/.dev.vars   # then put random values in it
npm run migrate:local
npm run dev:api        # http://localhost:8787
npm run dev:web        # http://localhost:5173 (proxies /api to 8787)
npm run seed:dev       # synthetic tenant "demo"; prints the sign-ins
```

Checks: `npm run check` (lint, boundaries, register, types, all tests, builds). API tests run inside workerd with real D1 and Durable Object SQLite (`@cloudflare/vitest-plugin`).

Reset local data: stop the API and delete `apps/api/.wrangler/state`, then run `npm run migrate:local` and `npm run seed:dev` again.

Regenerate generated files: `npm run docs:register` after editing `docs/owner-confirmations.json`; `npm run openapi` (with the API running) after changing routes; `npm run types -w @cemms/api` after changing `wrangler.jsonc`.
