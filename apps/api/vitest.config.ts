import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations("./db/control");
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            // Production enforces the owner's authenticator; tests exercise that path.
            MFA_ROLES: "OWNER,PLATFORM_ADMIN",
            // Test-only secrets; real ones are set with `wrangler secret put`.
            JWT_SECRET: "test-only-jwt-secret-0123456789abcdef0123456789",
            MFA_ENC_KEY: "dGVzdC1vbmx5LTMyLWJ5dGUta2V5LWZvci1tZmEtISE=",
            PLATFORM_BOOTSTRAP_TOKEN: "test-only-platform-bootstrap-token-0123456789",
          },
        },
      }),
    ],
    test: { setupFiles: ["./test/setup.ts"], testTimeout: 30_000 },
  };
});
