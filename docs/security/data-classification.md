# Data Classification

| Class | Examples | Where | Rules |
|---|---|---|---|
| Secret | Passwords (hash only), refresh tokens (hash only), TOTP secrets (AES-GCM), JWT signing key, bootstrap token, MFA/backup key | Control D1, Workers secrets | Never logged; never in IndexedDB or localStorage; rotate on exposure |
| Personal | Worker names and employee codes, user display names, who captured what | Tenant DB, control D1, phone IndexedDB (reference data) | Tenant-scoped; logs redact; exports role-gated (Phase 1B); worker gender is not collected (OC-99) |
| Operational | Attendance, weigh-ins, daily log readings, corrections, audit | Tenant DB, phone IndexedDB until synced | Tenant and estate scoped; append-only history |
| Configuration | Settings, owner answers, log kinds, masters | Tenant DB | Changes audited; unconfirmed values blocked in production |
| Public (Phase 1B) | QR trace allowlist fields | Public route | Strict allowlist; no worker data |

Residency: data is placed in Asia-Pacific by location hint. This is not an India-only guarantee.
