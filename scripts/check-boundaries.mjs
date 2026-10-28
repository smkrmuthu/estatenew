// Fails when a module imports across a boundary it must not cross (see docs/architecture/modules.md).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const files = (dir) =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (["node_modules", "dist", ".wrangler"].includes(n)) return [];
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
  });

const rules = [
  { from: "packages/domain/src", deny: [/^@cemms\//, /^zod$/, /^hono/, /^drizzle/, /apps\//], why: "domain is pure business rules with no I/O or framework" },
  { from: "packages/contracts/src", deny: [/apps\//, /^hono/, /^drizzle/], why: "contracts are shared schemas only" },
  { from: "apps/web/src", deny: [/apps\/api/, /^drizzle/, /^hono/, /control\//, /tenant\//], why: "the web app talks to the API over HTTP only" },
  { from: "apps/api/src/tenant", deny: [/\/control\//, /\.\.\/routes/, /\.\.\/\.\.\/routes/, /\/auth\//], why: "tenant data code never touches the control plane or HTTP layer" },
  { from: "apps/api/src/routes", deny: [/tenant\/modules\//, /tenant\/schema/], why: "routes reach tenant data only through callTenant (the Durable Object)" },
];

const problems = [];
for (const rule of rules) {
  for (const file of files(join(root, rule.from))) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/(?:import|export)[^"']*from\s+["']([^"']+)["']|import\(["']([^"']+)["']\)/g)) {
      const spec = m[1] ?? m[2];
      if (rule.deny.some((re) => re.test(spec)) && !/import type/.test(m[0])) problems.push(`${relative(root, file)} imports "${spec}" (${rule.why})`);
    }
  }
}
if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log("Module boundaries OK");
