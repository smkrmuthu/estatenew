// Renders docs/owner-confirmations.md from docs/owner-confirmations.json (the source of truth).
// Usage: node scripts/render-register.mjs [--check]
import { readFileSync, writeFileSync } from "node:fs";

const src = new URL("../docs/owner-confirmations.json", import.meta.url);
const out = new URL("../docs/owner-confirmations.md", import.meta.url);
const { items, updated } = JSON.parse(readFileSync(src, "utf8"));

const esc = (s) =>
  String(s ?? "")
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ");
const label = { confirmed: "Confirmed", open: "Open", "answered-unclear": "Answered, meaning unclear" };

const lines = [
  "# Owner Confirmation Register",
  "",
  `Generated from \`docs/owner-confirmations.json\` (updated ${updated}). Do not edit by hand; edit the JSON and run \`npm run docs:register\`.`,
  "",
  "Rules: a ticked box or written comment from the owner is confirmed; a blank is open. Proposed defaults from the architecture document or the prototype are never treated as answers. Items marked **Blocks production** must be confirmed before the affected behaviour is switched on for a live tenant.",
  "",
  `- Confirmed: ${items.filter((i) => i.status === "confirmed").length}`,
  `- Answered, meaning unclear: ${items.filter((i) => i.status === "answered-unclear").length}`,
  `- Open: ${items.filter((i) => i.status === "open").length}`,
  `- Open and blocking production activation: ${items.filter((i) => i.blocksProductionActivation).length}`,
  "",
];

const sections = [...new Set(items.map((i) => i.section))];
for (const section of sections) {
  lines.push(`## ${section}`, "", "| ID | Question | Owner answer | Status | Phase | Blocks production | Interim behaviour |", "|---|---|---|---|---|---|---|");
  for (const i of items.filter((x) => x.section === section)) {
    lines.push(
      `| ${i.id} | ${esc(i.question)} | ${esc(i.ownerAnswer ?? (i.proposedDefault ? `Proposed: ${i.proposedDefault}` : ""))} | ${label[i.status] ?? i.status} | ${i.phase} | ${i.blocksProductionActivation ? "Yes" : ""} | ${esc(i.interimBehavior)} |`,
    );
  }
  lines.push("");
}

const text = `${lines.join("\n")}`;
if (process.argv.includes("--check")) {
  if (readFileSync(out, "utf8") !== text) {
    console.error("docs/owner-confirmations.md is out of date. Run npm run docs:register.");
    process.exit(1);
  }
} else {
  writeFileSync(out, text);
  console.log(`Wrote ${items.length} items to docs/owner-confirmations.md`);
}
