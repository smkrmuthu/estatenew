// Fetches the OpenAPI document from a running API and writes docs/api/openapi.json.
// Usage: node scripts/openapi.mjs [baseUrl] [--check]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const base = process.argv.find((a) => a.startsWith("http")) ?? "http://localhost:8787";
const out = new URL("../docs/api/openapi.json", import.meta.url);
const doc = await (await fetch(`${base}/api/v1/openapi.json`)).json();
const text = `${JSON.stringify(doc, null, 2)}\n`;
if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(out, "utf8");
  } catch {}
  if (current !== text) {
    console.error("docs/api/openapi.json is out of date. Run node scripts/openapi.mjs and review the API change.");
    process.exit(1);
  }
  console.log("OpenAPI document unchanged");
} else {
  mkdirSync(new URL("../docs/api/", import.meta.url), { recursive: true });
  writeFileSync(out, text);
  console.log(`Wrote ${Object.keys(doc.paths).length} paths to docs/api/openapi.json`);
}
