# ADR-0013: Workers are allotted to the estates they work in

- Status: Interim
- Source: project lead instruction in chat, 28 October 2026 ("Workers are for both estates"; then "add estate selection for each worker in the add worker column")
- Approver: Muthu Kumar

## Context

Glazebrooke and Byson Valley share one workforce. Workers were tied to a single estate, so Byson Valley's register and plucking list were empty. A first version used an "all estates" flag; the estate then asked to choose the estates for each worker instead.

## Decision

A worker keeps a home estate (ownership and who may edit) and is allotted to one or more estates in the table `worker_estates`. The worker appears in the register, plucking list, reports and reference data of each allotted estate. Masters shows one list of workers with an Estates column, and the worker form has an "Estates the worker works in" tick list (at least one). A file can set it with the optional `estates` column (codes separated by `;`, for example `GLZ;BYV`) or the older `all_estates` column (YES allots to every estate). Tenant migration 0006 creates the table: every worker gets their home estate, and workers that had the all-estates flag get every estate. The old `all_estates` column stays in the database, unused. Changing a worker's estates needs `masters.write` on each estate added or removed; estates a user cannot see keep their allotment.

A worker allotted to several estates cannot be marked present in two estates in the same shift of one day: the second record is rejected with `WORKER_ELSEWHERE`. Absent can be recorded in either. This is a safe default while the duplicate-attendance policy is unconfirmed; it also blocks a half day in each estate until the owner decides.

## Consequences

- Reports for an estate count the workers allotted to it.
- Muster (plucking) entries are not limited per day, so a worker can pluck in two estates.
- Editing a worker needs `masters.write` on the home estate.
- Owner question to confirm: may one worker work a half day in each estate on the same day? Not a release blocker; the safe default applies.
