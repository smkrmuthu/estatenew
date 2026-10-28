// Secrets are set with `wrangler secret put` (staging/production) or .dev.vars (local).
interface CemmsSecrets {
  JWT_SECRET: string;
  /** Base64 of 32 random bytes; encrypts TOTP secrets and nightly backups at rest. */
  MFA_ENC_KEY: string;
  /** Bootstrap credential for creating tenants; rotate after first use. */
  PLATFORM_BOOTSTRAP_TOKEN: string;
  /** Optional: a second copy of every backup goes to Google Drive when all three are set (see docs/operations/backup-and-restore.md). */
  GDRIVE_CLIENT_ID?: string;
  GDRIVE_CLIENT_SECRET?: string;
  GDRIVE_REFRESH_TOKEN?: string;
}
interface Env extends CemmsSecrets {}
declare namespace Cloudflare {
  interface Env extends CemmsSecrets {}
  interface GlobalProps {
    mainModule: typeof import("./index");
  }
}
