import { describe, expect, it } from "vitest";
import committed from "../../../docs/api/openapi.json";
import { api, setupTenant } from "./helpers";

describe("smoke", () => {
  it("health and openapi", async () => {
    expect((await api("/health")).body.ok).toBe(true);
    const doc = (await api("/openapi.json")).body;
    expect(doc.openapi).toBe("3.1.0");
    expect(Object.keys(doc.paths)).toContain("/api/v1/sync/push");
    // The committed contract must match the code; regenerate with `npm run openapi` and review the diff.
    expect(doc).toEqual(committed);
  });
  it("sets up a tenant end to end", async () => {
    const s = await setupTenant();
    expect(s.ref.fields).toHaveLength(3);
    expect(s.ref.workers).toHaveLength(4);
    expect(s.f2.crops).toEqual(["COFFEE", "PEPPER"]);
  });
});
