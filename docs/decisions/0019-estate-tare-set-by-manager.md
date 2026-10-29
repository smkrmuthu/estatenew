# ADR-0019: The estate's tare is set by a manager or owner

- Status: Superseded in part by ADR-0021 (the tare is now one value for all estates, set in Masters)
- Source: project lead instruction in chat, 29 October 2026 ("Let the manager/owner can decrease/increase" the tare); the project lead chose "one per estate" and "set by manager". Tare is the total weight taken off one weigh-in: net = gross − tare, not multiplied by the number of bags.
- Approver: Muthu Kumar

## Context

The weigh-in form had a free "Tare (kg)" box that a supervisor could type into. OC-19 (is the bag or basket weight deducted) and OC-87 (how tare is found) are still open with the estate owner, so the existing `muster.tare.mode` setting stays on entered-by-hand (`MANUAL`).

## Decision

- Each estate has a default tare (`estates.default_tare_g`, tenant migration 0007). It starts at 0, so weigh-ins behave as before until a manager or owner sets it.
- Managers and owners (`masters.write`) set it under Manage → Setup → Tare (bag weight), through `PUT /estates/{estateId}/tare`. Each change is audited with the old and new value.
- A supervisor's weigh-in always takes the estate's tare off, whatever the phone sent. The form shows the tare read-only. The estate's tare reaches phones in the reference lists, so it works offline.
- A manager or owner may enter another tare on a single weigh-in (blank means the estate's tare). Corrections keep their own tare box, as before.
- A change applies to weigh-ins saved from then on. Saved weigh-ins keep the tare they were saved with.
- The weigh-in list now shows Gross, Tare and Net for each row.

## Consequences

- A supervisor's phone may show a net based on the tare it last downloaded. If a manager changes the tare before that weigh-in uploads, the server's tare and net win and the list shows them after the next refresh.
- If the owner answers that the bag weight is per bag, tare becomes bags × bag weight (the existing `PER_BAG` mode) and this setting changes meaning. Until then it is one fixed figure per weigh-in.
