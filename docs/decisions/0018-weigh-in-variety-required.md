# ADR-0018: A weigh-in must name its variety

- Status: Interim
- Source: project lead instruction in chat, 29 October 2026 ("this variety should be mandatory")
- Approver: Muthu Kumar

## Context

The Plucking page offered "Variety (optional)" for a field that has no subdivisions, and the server accepted a weigh-in without one. The setting `muster.variety.required` already existed and was off. OC-13 and OC-14 (varieties and divisions with more than one variety) are still open with the estate owner.

## Decision

- `muster.variety.required` is now on by default. The server refuses a new weigh-in or a correction without a variety (`VARIETY_REQUIRED`), and the variety must still be one of the crop's varieties and one the field lists.
- The Plucking page shows "Variety" without "optional", keeps Save and next worker off until one is picked, and says why. A field with one variety in its subdivisions fills it in; a field with several asks for the pick, as before.
- The rule reaches the app inside the reference lists (`rules.varietyRequired`), so it also holds offline. An older cached list without it counts as required.
- The setting can still be switched off by the owner under settings if the estate decides otherwise.

## Consequences

- A field with no variety listed cannot be weighed until a variety is added for it in Masters → Varieties or on its subdivisions.
- Weigh-ins saved on a phone before this change, without a variety, are refused when they upload and show as not accepted; they must be re-entered with a variety.
