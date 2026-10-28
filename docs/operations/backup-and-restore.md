# Backup and restore

## What is protected

| Data | Normal protection | Extra copy |
|---|---|---|
| Each estate group's data (workers, fields, attendance, plucking, Daily log, audit) | Durable Object SQLite, 30-day point-in-time restore | Nightly encrypted copy in R2 (`tenants/<tenant id>/backups/<time>.json.enc`) with a manifest next to it |
| Sign-in side (tenants, users, grants, devices, domains, platform audit) | D1 Time Travel | Nightly encrypted copy in R2 (`control/backups/…`). Sessions and refresh tokens are left out on purpose |
| Entries still on a phone | The phone's outbox (IndexedDB) | None until the phone syncs. Copies hold only what the server has received |

## How the nightly copy works

- Cron `30 20 * * *` (UTC), about 2:00 am India time, runs for the control database and every tenant.
- Each copy is encrypted with `MFA_ENC_KEY`, written to R2, read back, decrypted and compared with its SHA-256 before it is called `verified`. The manifest holds the time, size, checksum, migration version and row counts per table (no worker data).
- One failure does not stop the others; failures are logged as `backup.failed` and `backup.run.incomplete`.
- The owner sees the latest copies in Manage → Backups, a warning when the last good copy is older than 30 hours, and a **Back up now** button.
- Platform side: `POST /platform/backups/run` (header `x-platform-token`) runs everything now; `GET /platform/backups` lists the newest copies.
- Copies are kept (they are small). Add a retention rule in R2 when storage matters.

## Keep the key safe

The copies can only be opened with `MFA_ENC_KEY`. It is a Worker secret per environment; **keep a second copy of each environment's key in the office password manager**. If the key is lost, the R2 copies cannot be read (the 30-day Cloudflare restore is not affected). Do not rotate the key without re-making the copies first. A separate backup key is still planned.

## Restore (a disaster, or a drill)

A restore never goes into the live database. It fills a new, empty database and checks the row counts, and the tenant is switched over as a separate, deliberate step.

1. Pick the tenant code and, if needed, the backup key (otherwise the newest verified copy is used).
2. Restore into a new database name:

   ```bash
   curl -sS -X POST https://<site>/api/v1/platform/tenants/<code>/restore \
     -H "x-platform-token: $PLATFORM_BOOTSTRAP_TOKEN" -H "content-type: application/json" \
     -d '{"targetDbName":"<code>-restore-YYYYMMDD"}'
   ```

   The answer lists rows per table and the SQL for the switch-over. The app version must match the backup's migration version, or the restore refuses with `VERSION_MISMATCH`.
3. Check the answer (workers, attendance_records, muster_entries and the other counts match the backup's manifest).
4. Switch over (this moves everyone to the restored copy, so do it in a quiet moment and tell the supervisors to sync afterwards):

   ```bash
   npx wrangler d1 execute cemms-control-<env> --remote --command "UPDATE tenants SET db_name = '<target>' WHERE code = '<code>';"
   ```
5. Sign in, open Reports and Attendance and compare with the last known figures. Entries made after the backup are gone from the server; phones that still hold them will send them again when they sync.
6. For the control database, use D1 Time Travel to a time before the problem; the R2 copy of it is a second source.

If only a recent mistake needs undoing and the loss is within 30 days, point-in-time restore (Durable Object bookmark) can be simpler than the R2 copy; use it first.

## Drills

Do a restore drill into a throw-away database name before go-live and after any change to the backup code, and record the date here.

| Date | Environment | Result |
|---|---|---|
| 2026-10-28 | Automated test (workerd) | Restore into a new database and switch-over reproduced workers, fields, attendance (both shifts) and weigh-ins |
| 2026-10-28 | Staging (Glazebrooke, real masters) | Backup of control + 2 tenants verified; Glazebrooke restored into the throw-away database `drill-glazebrooke-20261028` (not switched in): every table count matched the backup (36 workers, 4 fields, 2 attendance records) |
