# Glossary

| Term | Meaning |
|---|---|
| Tenant | One customer (an estate group). Has its own database. The first tenant runs Glazebrooke and Byson Valley. |
| Estate | A property inside a tenant. Roles are granted per estate. |
| Field | A planted area of an estate. The first tenant calls it a Division (setting `terminology.field`). Can carry Coffee, Pepper or both. |
| Subdivision | Optional part of a field with one land use, at most one variety and acres, lettered A, B, C (OC-69, AQ-24 open). Not on weigh-ins yet. |
| Crop | COFFEE or PEPPER, chosen on each weigh-in. |
| Variety | A cultivar of a crop (for example Chandana Giri, Selection 9). List and spellings are open (OC-14, OC-73). |
| Attendance sheet | One estate's attendance for one business date. States: DRAFT, SUBMITTED, APPROVED. |
| Business date | The estate-local calendar date of the work (time zone setting), not the upload time. |
| Muster / weigh-in | Evening weighing of each worker's picking: gross, bags, tare, net (grams). |
| Daily log | Configurable readings (kinds) such as temperature or rain. Which readings is open (OC-100). |
| Mutation | One change made on a device, uploaded through `/sync/push` with a stable id. |
| Outbox (device) | IndexedDB queue of mutations waiting to upload. |
| Outbox (server) | `outbox_events` table: domain events written in the same transaction as the change. |
| Conflict | Two entries that cannot both be true (same worker and day, or a stale edit). Never resolved automatically. |
| Correction | A change to a submitted record, with a reason; the old version stays in `record_revisions`. |
| Gate | An owner question (OC-n) or architecture question (AQ-n) that must be answered before a behaviour is switched on in production. |
| Proposed | A default from the architecture document or prototype that the owner has not confirmed. |
