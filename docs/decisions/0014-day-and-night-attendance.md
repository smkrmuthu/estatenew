# ADR-0014: Day and Night attendance registers

- Status: Interim
- Source: project lead instruction in chat, 28 October 2026 (some workers do a field job by day and night watch by night; chose "Day and Night rows")
- Approver: Muthu Kumar

## Context

Attendance allowed one row per worker per estate per day, so a worker who picks by day and watches by night could only have one of the two recorded.

## Decision

Each day has a Day register and a Night register per estate. A worker can have one row in each, with its own status, field and job. Each register has its own submit and approval. A night is dated by the evening it starts. Changes queued before shifts existed count as Day. Tenant migration 0005 rebuilds the attendance sheet and record tables with a `shift` column (existing rows become DAY). A second row for the same worker, day and shift is a conflict, as before. The shared-worker rule (ADR-0013) applies per shift: not present in two estates in the same shift.

## Consequences

- Dashboard and daily summary headcount stay the Day register; the summary adds the Night register's state and present count.
- A worker's history lists both rows; `daysWorked` currently counts a Night row as one day. How night watch is counted or paid is not decided and payroll is deferred.
- Weigh-in takes the field suggestion from the Day register only.
- Owner questions to confirm: does a night watch count as an extra day, a half day or its own rate; is a night dated by the evening it starts; may the same person be present in Day and Night on one date (allowed for now).
