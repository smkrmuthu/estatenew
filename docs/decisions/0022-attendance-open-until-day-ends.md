# ADR-0022: Attendance stays open until the end of the day; earlier days by setting

- Status: Interim (changes the lock rule in ADR-0017's flow; OC-86 stays open)
- Source: project lead instruction in chat, 30 October 2026 ("Allow the submit button till the end of the day ... and via edit, allow to edit previous one day attendance")
- Approver: Muthu Kumar

## Context

Until now a submitted attendance day was closed to new entries at once; only a manager's correction with a reason could change it. On 30 October a supervisor had saved three workers and could not add the rest after submitting. The project lead wants the register to keep taking entries until the end of the day, and wants the previous day to stay editable.

## Decision

- A submitted or approved day takes entries again until its business day ends in the estate's time zone. This is `dayStaysOpen` in the attendance module and is reported to the app as `open` on `GET /estates/{estateId}/attendance/{date}`.
- An entry added or changed on such a day sends the sheet back to DRAFT (submit and approval details cleared) and records `attendance.sheet.reopen` in the audit trail with the old and new sheet. It must be submitted, and for a supervisor approved, again. A manager's or owner's own submit is approved straight away as before (ADR-0017).
- Submitting again while the day is open and nothing changed since is accepted and changes nothing, so the button never has to be greyed on an open day.
- The previous day: the existing setting `attendance.backEntryDays` (OC-86, default 0, gate OC-86) now also keeps a submitted day open for that many earlier days. Set to 1, a supervisor can fill in or change yesterday. It can be set under Manage > Attendance types. In production the gate refuses any value above 0 until the owner records OC-86.
- Past those days the old rule holds: new entries are refused (`SHEET_LOCKED`) and a manager corrects a saved entry with a reason; the old entry stays in the history.
- Entries captured offline before midnight but synced after it, on a day that was already submitted, are refused with `SHEET_LOCKED` and shown as not accepted; a manager enters them as a correction. The capture date is not used to keep a submitted day open.

## Consequences

- An approved day can return to draft the same day if more is added. Reports show it as not submitted until it is submitted again; nothing is lost, and the audit trail shows every reopen.
- OC-86 is still the owner's to answer (past-day entry, how many days). The interim value of one day is on staging only until the owner confirms.
