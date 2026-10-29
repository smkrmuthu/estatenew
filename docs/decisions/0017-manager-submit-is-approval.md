# ADR-0017: A manager's own submit approves the day

- Status: Interim
- Source: project lead instruction in chat, 29 October 2026 ("for Manager should not need to approve for Attendance management"); the project lead chose "the manager's own submit counts as approved" over removing approval for everyone
- Approver: Muthu Kumar

## Context

Every submitted register (Day or Night) waited for a second step, where someone holding `attendance.approve` approved it. When the person submitting is already a manager or owner, that second step only repeated their own action. OC-7 (who approves) is still open with the estate owner.

## Decision

- When a user who holds `attendance.approve` for the estate (Estate Manager, Owner) submits a register, the register goes straight to Approved. The submit and the approval are both written to the audit trail, with the same user and time, and the approval is marked "Approved on submit by a user who may approve".
- A supervisor's submit still goes to Submitted and waits for a manager, who can approve it or send it back with a reason.
- If the day has unresolved conflicting entries, a manager's submit stays Submitted, as an approval would be refused in that case too.
- Corrections after approval are unchanged: append-only, with a reason.
- Not changed: the `attendance.approval.required` setting is still not used by the code. Removing approval for everyone is not done.

## Consequences

- The Attendance screen shows "Submit and approve" for managers and owners, and "Submit for approval" for supervisors.
- Owner answer to OC-7 may still change who approves a supervisor's day.
