import { describe, expect, it } from "vitest";
import { hashPassword, PBKDF2_MAX_PER_CALL, verifyPassword } from "../src/core/crypto";

describe("password hashing", () => {
  it("uses six chained 100,000-iteration rounds and verifies", async () => {
    const stored = await hashPassword("correct horse battery");
    expect(stored).toMatch(/^pbkdf2-sha256x6\$100000\$[\w-]+\$[\w-]+$/);
    expect(await verifyPassword("correct horse battery", stored)).toBe(true);
    expect(await verifyPassword("wrong", stored)).toBe(false);
  });

  it("refuses hashes that would need more than the runtime allows in one call, or unknown schemes", async () => {
    const stored = await hashPassword("x");
    const [, , salt, hash] = stored.split("$");
    expect(await verifyPassword("x", `pbkdf2-sha256x6$${PBKDF2_MAX_PER_CALL + 1}$${salt}$${hash}`)).toBe(false);
    expect(await verifyPassword("x", `pbkdf2-sha256$600000$${salt}$${hash}`)).toBe(false);
    expect(await verifyPassword("x", "garbage")).toBe(false);
  });
});
