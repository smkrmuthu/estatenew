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

## Update, 29 October 2026: one worker, both shifts on one day

Source: project lead instruction in chat, 29 October 2026 ("the same worker can do both day and night shift in a single day"). Approver: Muthu Kumar. The estate owner has not answered on the form (OC-110, OC-111).

The data model already allows it: one row per estate, date, worker and shift. What changes is how the rest of the system treats such a worker, so nobody is counted twice or left out.

Design:

- **Two rows, never merged.** Day and Night stay separate rows with their own status, field, job, submit and approval. Correcting one does not touch the other.
- **Different estates are allowed.** A worker may be Day at one estate and Night at the other; the shared-worker rule (ADR-0013) still stops two present marks in the same shift.
- **Count people and shifts separately.** Daily summary shows Day present, Night present and "worked both shifts" (distinct workers present in both). It does not add Day and Night into one headcount, so a person is never counted twice as a person.
- **No combined day-count until the owner decides.** The summary man-days figure stays Day-only. Worker history stops counting a Night row as an extra day: it reports days worked (Day rows) and night shifts as two separate numbers. Today `daysWorked` counts a Night row as a day, which would show 2 days for one date; that is the bug this design removes.
- **Attendance screen hints.** On either register, a worker already present in the other shift that date shows a small "Also on Day: Picking, Field A" (or Night) tag, so supervisors see the double shift without switching tabs. Absent or unmarked in the other shift shows nothing.
- **Excel.** New format already has one row per worker per shift. Old format keeps the Day row first and the Night row below it marked "Night shift" in remarks, with plucking only on the first row; no change.
- **Weigh-in is unchanged.** It is per worker per day, not per shift, and still takes its field suggestion from the Day register.
- **No hours or rest-period rule.** Nothing blocks or warns about long hours until the owner states one.

Open owner questions (recorded in `docs/owner-confirmations.md`): how a night shift counts and is paid (OC-110) and whether the same worker doing Day and Night on one date is allowed in the owner's process (OC-111, allowed now on the project lead's word).

