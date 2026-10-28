# ADR-0013: Workers can work in all estates

- Status: Interim
- Source: project lead instruction in chat, 28 October 2026 ("Workers are for both estates only"; chose "Shared by both estates")
- Approver: Muthu Kumar

## Context

Glazebrooke and Byson Valley share one workforce. Workers were tied to a single estate, so Byson Valley's register and plucking list were empty.

## Decision

A worker keeps a home estate (ownership and who may edit) and has a flag `all_estates`. A flagged worker appears in every estate's attendance register, plucking list, reports and reference data, and can be recorded in any estate of the tenant. The flag is set in Masters (worker form) or by the optional `all_estates` CSV column (YES or NO). Tenant migration 0004 adds the column; existing workers stay unflagged. Estate-scoped users see shared workers but not other estates' workers.

A shared worker cannot be marked present in two estates on the same day: the second record is rejected with `WORKER_ELSEWHERE` and a clear message. Absent can be recorded in either. This is a safe default while the duplicate-attendance policy is unconfirmed; it blocks a half day in each estate until the owner decides.

## Consequences

- Reports for an estate include shared workers in its worker counts.
- Muster (plucking) entries are not limited per day, so a shared worker can pluck in both estates.
- Editing a shared worker needs `masters.write` on the home estate.
- Owner question to confirm: may one worker work a half day in each estate on the same day? Not a release blocker; the safe default applies.
