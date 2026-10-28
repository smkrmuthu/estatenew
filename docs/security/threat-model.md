# Threat Model (Phase 1A)

Method: list assets, entry points and the threats that matter most for a multi-tenant estate app used on shared phones with poor signal. Status shows what is built and tested.

## Assets

Worker identities and attendance (personal data), weigh-in weights (drive pay later), tenant boundaries, credentials and sessions, audit trail integrity.

## Entry points

`/api/v1/auth/*`, `/api/v1/platform/tenants` (bootstrap token), bearer-token API, `/sync/push`, CSV import, the installed PWA and its IndexedDB, nightly backups in R2.

| Threat | Control | Status |
|---|---|---|
| A user reads or writes another tenant's data | Tenant comes only from the verified token; each request opens only that tenant's Durable Object; the object refuses a scope for another tenant; estate ids from other tenants resolve to 404 | Built; `test/isolation.test.ts` covers every tenant route and the Durable Object directly |
| Supervisor acts outside their estate or role | Estate-scoped grants checked in the tenant service for every operation, including each sync item | Built and tested |
| Token forgery, replay, theft | HS256 JWT with audience, 15-minute life, session/device/user/tenant re-checked each request; refresh token httpOnly SameSite=Strict, hashed at rest, rotated, reuse revokes the session | Built and tested |
| Password guessing | PBKDF2-SHA256 600k; same response for unknown user and wrong password; lockout after 5; per-IP and per-user rate limits | Built and tested |
| Owner or manager account takeover | TOTP MFA required for Owner, Estate Manager, Platform Admin; replay of a used code refused | Built and tested (enrolment at first sign-in) |
| CSRF on cookie endpoints | Refresh/logout need `X-CEMMS-CSRF` and same origin; API uses bearer header; cross-origin browser requests refused | Built and tested |
| Duplicate or replayed sync uploads | `(device_id, mutation_id)` stored with the result; payload hash checked; mutation id reuse for other data refused | Built and tested |
| Device used by another person, or lost | Mutations must come from the session's device; device revoke blocks sign-in and sync; session lifetime bounded (12 h default, OC-101 open); no tokens in IndexedDB | Built; local PIN lock not built (see limitations) |
| Silent overwrite of attendance | Duplicate worker/day and stale edits become conflicts; manager resolves with a reason; both versions kept | Built and tested |
| Tampering with history | Corrections append to `record_revisions` and `audit_log`; submitted records change only through corrections | Built and tested |
| CSV formula injection / oversized files | Cells starting with `= + - @` refused; 1 MB / 5,000-row limits; preview before apply; whole import is one transaction | Built and tested |
| Platform bootstrap abuse | Endpoint disabled unless a 32+ character token is set; constant-time compare; audited | Built; rotate the token after creating the first tenant |
| PII in logs | Logger redacts names, payloads, remarks, tokens, passwords, CSV | Built |
| Public QR enumeration | Not built (Phase 1B). Will return an allowlist only, never worker names | Planned |
| Support staff access | Platform Admin role has no tenant data permissions; audited time-limited grant is Phase 1B | Safe by default |

## Known gaps (tracked in implementation-status.md)

- Offline continuation after a reload keeps working until the session ends without a local PIN; a phone left unlocked can add entries as that supervisor until then (server still refuses revoked devices on upload).
- Backups are encrypted with the same key as MFA secrets; a separate backup key is planned.
- WAF rules and Cloudflare account settings are not in code yet; configure on the zone before go-live.
