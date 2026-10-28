# ADR-0004: Authentication

- Status: Accepted (architecture revision 27 October 2026)

## Decision

- Passwords: PBKDF2-SHA256, 600,000 iterations, 16-byte random salt, WebCrypto. Stored as `pbkdf2-sha256$600000$<salt>$<hash>`.
- Access token: HS256 JWT, 15 minutes, carries user, tenant, session and device ids. Held in memory by the web app only (never IndexedDB or localStorage).
- Refresh token: random 256-bit value in an httpOnly, Secure, SameSite=Strict cookie scoped to `/api/v1/auth`. Stored only as a SHA-256 hash. Rotated on every use; reuse of a spent token revokes the whole session (reuse detection).
- CSRF: refresh and logout need the `X-CEMMS-CSRF: 1` header and a same-origin `Origin`. API calls use the Bearer header, not cookies.
- Lockout: 5 failed sign-ins lock the account for 15 minutes; also rate limited per IP and username.
- Every request re-checks that the session is not revoked and the user is active (fail closed).
- MFA: TOTP (RFC 6238) is required for Owner and Platform Admin; enrolment happens at first sign-in.
- Session lifetime: 12 hours absolute by default (`auth.offlineSessionHours`). Longer offline windows (OC-101, up to 7 days) stay blocked until the owner confirms.
- Devices: each browser install registers a device id; sessions are bound to it and can be revoked.
