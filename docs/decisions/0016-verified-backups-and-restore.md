# ADR-0016: Verified nightly backups and restore into a new database

- Status: Interim
- Source: project lead instruction in chat, 28 October 2026 ("Make sure all backup is done and no data is lost")
- Approver: Muthu Kumar

## Context

A nightly job already copied each tenant database to R2, but it was untested, skipped the control database, had no check that a copy could be read, no way to see it, and no restore path.

## Decision

The nightly job and a manual run back up the control database (without sessions and refresh tokens) and every tenant, encrypt each copy, read it back and compare its checksum, and write a manifest. The owner sees them in Manage → Backups and can start one. A platform endpoint restores a tenant's newest verified copy into a new, empty database (never the live one) and checks row counts; switching the tenant over is a separate manual SQL step. Tests cover the round trip and the switch-over.

## Consequences

- Copies sit in the same Cloudflare account as the data; a copy outside Cloudflare is still to be decided.
- Copies depend on `MFA_ENC_KEY`; the key must be kept elsewhere too.
- A restore needs the matching app version (same tenant migration version).
- Owner question: how long to keep copies, and whether a second location is wanted.
