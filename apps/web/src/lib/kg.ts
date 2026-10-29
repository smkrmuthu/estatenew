/** Typed weights like ".2" or "4." mean 0.2 and 4: add the missing digit so they parse. */
export function normalizeKg(text: string): string {
  const t = text.trim();
  const withLead = t.startsWith(".") ? `0${t}` : t;
  return withLead.endsWith(".") ? withLead.slice(0, -1) : withLead;
}
