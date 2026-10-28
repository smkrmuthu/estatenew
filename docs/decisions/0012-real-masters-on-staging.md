# ADR-0012: Real Glazebrooke masters on staging (exception)

- Status: Interim
- Source: project lead instruction in chat, 28 October 2026 ("You can take them into Staging env")
- Approver: Muthu Kumar

## Context

The project rule is that staging holds synthetic data only. The estate wants to validate on staging with its own workers, fields and varieties before 1 November 2026, taken from the estate's daily sheet (`Glazebrooke Estate.xls`).

## Decision

Real Glazebrooke masters are allowed on `glazebrooke-staging.oneuptech.co` only: 36 workers (name, generated code, type, area), 4 fields, 2 coffee varieties, 7 job types. Gender is not loaded (OC-99 open). Attendance and weigh-in test entries on staging stay test data.

## Consequences

- The source spreadsheet and generated CSVs stay out of git (`imports-local/`, `*.xls`, `*.xlsx` are ignored).
- Production masters are carried over by CSV export and import, not by copying databases or password hashes.
- Sample data (Worker A to L, S1 to S6, Block 1/2, sample varieties and jobs) was removed or set Inactive on 28 October 2026. Varieties and job types cannot be deleted in the app yet.
- The staging owner password was reset on the project lead's request (audited in `platform_audit`); the owner must change it at next sign-in.
