# ADR-0021: One tare for all estates, set in Masters

- Status: Interim (supersedes the per-estate part of ADR-0019)
- Source: project lead instruction in chat, 29 October 2026 ("One tare value for all estates, set in Masters and pre-filled on Plucking")
- Approver: Muthu Kumar

## Context

ADR-0019 gave each estate its own tare, set in Manage. The project lead now wants one value for every estate, kept in Masters and pre-filled on the Plucking form. The weight itself was not given, so none is assumed. OC-19 and OC-87 stay "answered, meaning unclear".

## Decision

- Tare is the tenant setting `muster.tare.defaultGrams` (grams, 0 to 500 000, starts at 0). It has no go-live gate: a manager or owner (`settings.configure`) sets it under Masters > Tare, and each change is audited with the old and new value.
- The Plucking form shows it read-only for supervisors. A manager or owner may enter another tare on one weigh-in; blank uses the default. The server takes the default off every supervisor weigh-in whatever the phone sent.
- It reaches phones in the reference lists (`rules.tareG`), so it works offline.
- Tenant migration 0008 keeps the highest per-estate figure already set (if any) as this setting and drops the `estates.default_tare_g` column. `PUT /estates/{estateId}/tare` and the Manage card are removed.
- Tare is one figure per weigh-in, not multiplied by the number of bags.

## Consequences

- A change applies to weigh-ins saved from then on; saved weigh-ins keep their tare.
- If the owner later wants different values per estate or a per-bag weight, this setting changes meaning.
