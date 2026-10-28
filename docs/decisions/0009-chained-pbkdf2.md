# ADR-0009: Chained PBKDF2 because Workers caps iterations at 100,000

- Status: Accepted
- Approver: Project owner (in chat), 28 October 2026
- Supersedes: the "single PBKDF2-SHA256 call at 600,000 iterations" detail in ADR-0004 and CLAUDE.md

## Context

Deploying to staging showed that Cloudflare's production runtime refuses PBKDF2 above 100,000 iterations in one `deriveBits` call: `Pbkdf2 failed: iteration counts above 100000 are not supported (requested 600000)`. Local workerd (Wrangler 4.154) does not enforce this, so the earlier local probe passed.

## Decision

Passwords are hashed with six chained PBKDF2-SHA256 rounds of 100,000 iterations each (600,000 HMAC-SHA256 iterations in total, the baseline's cost):

- round 1: key = password, salt = 16 random bytes
- round i (2 to 6): key = output of round i-1, salt = salt followed by the byte i
- output: 256 bits

Stored as `pbkdf2-sha256x6$100000$<salt>$<hash>`. `crypto.ts` refuses any single call above 100,000 so local tests behave like production. The scheme prefix allows a later upgrade (for example Argon2id in a bundled WASM module) by rehashing at the next sign-in.

## Consequences

- Same work factor as the baseline with native WebCrypto; about 50 ms CPU per sign-in (Workers Paid plan needed).
- Not a single standard PBKDF2 call; documented here and covered by `apps/api/test/crypto.test.ts`.
- Hashes made before this change (local development only) no longer verify; reset local data and reseed.
