# ADR-0015: Excel exports in the old and new format

- Status: Interim
- Source: project lead instruction in chat, 28 October 2026 (create the daily Excel in the attached format and mark it as old format; the estate may keep using it for some time; also a new-format file as a backup; each date as its own sheet)
- Approver: Muthu Kumar

## Context

The estate keeps a daily Excel sheet (`Glazebrooke Estate.xls`): one sheet per date, attendance on the left, plucking on the right. It will continue to use it for a while next to the app, and wants a backup of the app's own data in Excel too.

## Decision

The Reports page gets an "Excel files" view with a date range and, per estate, two downloads:

- **Old format (daily sheets):** an .xlsx with one sheet per date (named `dd-mm-yyyy`) that has attendance or weigh-ins, in the layout of the attached sheet: title band, Estate and Date row, Attendance and Plucking bands, the same 15 columns, thin borders, grey bands, the accounting number format. The title carries "- OLD FORMAT". The original title spelling is kept. One row per worker per shift (night rows say "Night shift" in Remarks), workers with no mark show "Not marked", and several weigh-ins on the same field and variety are added into one row. Up to 62 days.
- **New format (backup):** an .xlsx with About, Summary by day, Attendance and Plucking tables, up to 400 days.

Only entries the server has accepted are included. Both need `reports.workerDetail` (Owner, Estate Manager, Auditor) because they name workers and show their weights; each export is written to the audit trail (`report.export`). The files are .xlsx (not the old .xls), built by a small writer in the API with no extra library. Nothing is stored: files are made on request.

## Consequences

- Fields, jobs and varieties come from the app's lists, so names like "Pulp House" or "All Field" appear only if they are added as fields; the old sheet used them as places.
- A scheduled nightly copy to R2 was not asked for and is not built; it can reuse the same builders.
- Open: should night watch rows appear on the old sheet as separate rows (done) or be left out of it?
