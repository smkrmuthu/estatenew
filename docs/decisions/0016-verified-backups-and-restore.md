# ADR-0016: Verified nightly backups and restore into a new database

- Status: Interim
- Source: project lead instruction in chat, 28 October 2026 ("Make sure all backup is done and no data is lost")
- Approver: Muthu Kumar

## Context

A nightly job already copied each tenant database to R2, but it was untested, skipped the control database, had no check that a copy could be read, no way to see it, and no restore path.

## Decision

The nightly job and a manual run back up the control database (without sessions and refresh tokens) and every tenant, encrypt each copy, read it back and compare its checksum, and write a manifest. The owner sees them in Manage → Backups and can start one. A platform endpoint restores a tenant's newest verified copy into a new, empty database (never the live one) and checks row counts; switching the tenant over is a separate manual SQL step. Tests cover the round trip and the switch-over.

## Second copy in Google Drive (project lead instruction, 28 October 2026: "json will store in the GDrive")

When three Google secrets are set, each backup is also uploaded, still encrypted, to the owner's Google Drive using a refresh token for the owner's account (`drive.file` scope, the app's own folder, nothing deleted). It is off until the owner finishes the one-time setup in the runbook; a Drive failure never loses the Cloudflare copy and is shown to the owner.

## Consequences

- Copies sit in the same Cloudflare account as the data until the Drive copy is set up. Encrypted files in Google Drive put worker data (unreadable without the key) in a third-party service; the owner chose this.
- Copies depend on `MFA_ENC_KEY`; the key must be kept elsewhere too.
- A restore needs the matching app version (same tenant migration version).
- Owner question: how long to keep copies, and whether a second location is wanted.
