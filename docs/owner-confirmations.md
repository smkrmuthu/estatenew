# Owner Confirmation Register

Generated from `docs/owner-confirmations.json` (updated 2026-10-28). Do not edit by hand; edit the JSON and run `npm run docs:register`.

Rules: a ticked box or written comment from the owner is confirmed; a blank is open. Proposed defaults from the architecture document or the prototype are never treated as answers. Items marked **Blocks production** must be confirmed before the affected behaviour is switched on for a live tenant.

- Confirmed: 12
- Answered, meaning unclear: 2
- Open: 105
- Open and blocking production activation: 25

## Daily process overview

| ID | Question | Owner answer | Status | Phase | Blocks production | Interim behaviour |
|---|---|---|---|---|---|---|
| OC-1 | The overall daily process above is correct. | Yes | Confirmed | 0 |  | Confirmed. The seven-step daily process is the basis of the design. |
| OC-2 | The three processes (Pulping, Fermentation, Natural) are the only ones used today. | Yes | Confirmed | 0 |  | Confirmed. Only Routes A, B and C are seeded for coffee (Phase 1B). |
| OC-3 | Is there any step missing between plucking and packing? If yes, please describe it. | No | Confirmed | 0 |  | Confirmed. No extra step between plucking and packing. |

## Attendance

| ID | Question | Owner answer | Status | Phase | Blocks production | Interim behaviour |
|---|---|---|---|---|---|---|
| OC-4 | The supervisor will mark attendance on a mobile phone in the field, even where there is no internet. | Yes or Computer (WebApp) | Confirmed | 1A |  | Confirmed. Attendance is captured on the phone web app (works offline) or on the office web portal. |
| OC-5 | A worker stays in one field and does one job | NA | Answered, meaning unclear | 1A |  | Treat 'NA' as unclear. One field and one job per worker per day is recorded; a later change is a correction with a reason. Confirm the meaning of 'NA'. |
| OC-6 | Workers are organised in fixed groups (gangs), each with its own supervisor. If yes, how many groups and supervisors are there? | NA | Answered, meaning unclear | 1A |  | Treat 'NA' as unclear. No work groups are required; group assignment is only a bulk-entry shortcut. |
| OC-7 | The estate manager checks and approves each day's attendance after the supervisor submits it. If no, who approves? |  | Open | 1A | Yes | Approval workflow exists; approver is anyone holding attendance.approve on the estate (Owner or Estate Manager). Who approves is not confirmed. |
| OC-8 | These attendance types are enough: Present, Absent, Leave, Off day, Holiday. Please add any others. |  | Open | 1A | Yes | Only Present and Absent with Full day or Half day (from the process text accepted in Q1) are active. Leave, Off day and Holiday are seeded inactive as proposed. |
| OC-9 | Do you need to record the time each worker arrives and leaves? |  | Open | 1A |  | Arrival and departure times are not captured. |
| OC-10 | Do you want the application to calculate wages or pay per kilogram plucked now? (If not, this can be added in a later phase.) |  | Open | 2 |  | No wage or pay calculation. Deferred. |
| OC-11 | Approximately how many workers work on the estate on a normal day, and in the peak plucking season? Normal: ______ Peak: ______ |  | Open | 1A |  | Load tests use 300 workers per estate as an assumption, not an owner figure. |

## Fields and plucking

| ID | Question | Owner answer | Status | Phase | Blocks production | Interim behaviour |
|---|---|---|---|---|---|---|
| OC-12 | The division names in the estate details sheet are the names everyone uses (for example Super Kadu, No 6, Field 9-1). |  | Open | 1A | Yes | Field names come from the import file as given; the label 'Division' is a tenant terminology setting. |
| OC-13 | Some divisions have more than one variety (for example Super Kadu: 4 acres Chandana Giri and 6 acres Selection 9). |  | Open | 1A |  | A field can list several varieties; weigh-in variety is optional and not inferred. |
| OC-14 | The varieties are Chandana Giri, Selection 9 and YMG. Please add any others and explain what YMG is. |  | Open | 1A | Yes | Varieties are imported as master data; YMG and spellings stay as given until the owner explains them. |
| OC-15 | The division list has been received. Is there also a list of workers (Excel or paper) that can be loaded into the application? |  | Open | 1A | Yes | Worker list not yet received; CSV import is ready. Go-live needs the real list. |

## Evening muster (weigh-in)

| ID | Question | Owner answer | Status | Phase | Blocks production | Interim behaviour |
|---|---|---|---|---|---|---|
| OC-16 | Each worker's cherries are weighed and recorded separately. |  | Open | 1A | Yes | Each weigh-in is a separate per-worker record. |
| OC-17 | A worker may bring cherries more than once in a day (more than one weighing). |  | Open | 1A | Yes | Several weigh-ins per worker per day are stored as separate records and flagged in the summary; none are merged or rejected. |
| OC-18 | Cherries are measured in kilograms. If not, what is used (baskets, bags, other) and how much does one unit weigh? |  | Open | 1A | Yes | Kilograms only. Unit not confirmed; production activation blocked. |
| OC-19 | The weight of the bag or basket is deducted from the total. |  | Open | 1A | Yes | Gross, bag count and tare are stored as entered. Tare is entered by hand (default 0); per-bag tare is proposed and inactive. |
| OC-20 | A digital weighing scale is used. If yes, please write the make or model. |  | Open | 1A |  | Manual weight entry; no scale integration. |
| OC-21 | Is the quality of the cherries noted at weighing (for example ripe, green or damaged)? |  | Open | 1A |  | Cherry quality is not captured at weighing. |
| OC-22 | The same supervisor who marks attendance also records the evening muster. If no, who does? |  | Open | 1A |  | Any user with muster.capture on the estate can record weigh-ins. |

## Washing and sorting

| ID | Question | Owner answer | Status | Phase | Blocks production | Interim behaviour |
|---|---|---|---|---|---|---|
| OC-23 | The total weighed at the evening muster should match the quantity received for washing, and any difference must be explained. |  | Open | 1B |  | Not used in Phase 1A. Keep configurable; do not activate proposed defaults. |
| OC-24 | Washing is done on the same day as plucking. If no, when? |  | Open | 1B |  | Not used in Phase 1A. Keep configurable; do not activate proposed defaults. |
| OC-25 | Different varieties are washed and kept separately. |  | Open | 1B |  | Not used in Phase 1A. Keep configurable; do not activate proposed defaults. |
| OC-26 | Cherries plucked on different days can be combined into one lot. |  | Open | 1B |  | Not used in Phase 1A. Keep configurable; do not activate proposed defaults. |
| OC-27 | The weight of floaters and rejects is recorded. |  | Open | 1B |  | Not used in Phase 1A. Keep configurable; do not activate proposed defaults. |

## Processing

| ID | Question | Owner answer | Status | Phase | Blocks production | Interim behaviour |
|---|---|---|---|---|---|---|
| OC-28 | Who decides which process each lot goes to? (Owner, manager, processing operator) |  | Open | 1B |  | Not used in Phase 1A. Keep configurable; do not activate proposed defaults. |
| OC-29 | One washed lot can be divided, with part going to one process and part to another. |  | Open | 1B |  | Not used in Phase 1A. Keep configurable; do not activate proposed defaults. |
| OC-30 | Several washed lots can be combined into one processing batch. |  | Open | 1B |  | Not used in Phase 1A. Keep configurable; do not activate proposed defaults. |
| OC-31 | Different varieties can be mixed in one processing batch. |  | Open | 1B |  | Not used in Phase 1A. Keep configurable; do not activate proposed defaults. |
| OC-32 | After pulping, the coffee can go to either floor drying or tray drying. |  | Open | 1B |  | Not used in Phase 1A. Keep configurable; do not activate proposed defaults. |
| OC-33 | Is anything else recorded during pulping (for example machine used, water used, washing after pulping)? |  | Open | 1B |  | Not used in Phase 1A. Keep configurable; do not activate proposed defaults. |
| OC-34 | After fermentation, the coffee always goes to tray drying. |  | Open | 1B |  | Not used in Phase 1A. Keep configurable; do not activate proposed defaults. |
| OC-35 | Fermentation is done in tanks that have their own names or numbers. How many tanks are there? |  | Open | 1B |  | Not used in Phase 1A. Keep configurable; do not activate proposed defaults. |
| OC-36 | Which fermentation methods are used? Please list them. |  | Open | 1B |  | Not used in Phase 1A. Keep configurable; do not activate proposed defaults. |
| OC-37 | What flavour information should be recorded? Please list the flavour types or notes used. |  | Open | 1B |  | Not used in Phase 1A. Keep configurable; do not activate proposed defaults. |
| OC-38 | Is anything added during fermentation (for example yeast, fruit, spices)? |  | Open | 1B |  | Not used in Phase 1A. Keep configurable; do not activate proposed defaults. |
| OC-39 | Are readings taken during fermentation (for example acidity/pH, sugar/Brix, temperature)? If yes, which ones and how often (for example every 6 hours)? |  | Open | 1B |  | Not used in Phase 1A. Keep configurable; do not activate proposed defaults. |
| OC-40 | How long does fermentation usually last? Hours or days: ______ |  | Open | 1B |  | Not used in Phase 1A. Keep configurable; do not activate proposed defaults. |
| OC-41 | Natural drying uses whole cherries without pulping. |  | Open | 1B |  | Not used in Phase 1A. Keep configurable; do not activate proposed defaults. |
| OC-42 | How are cherries selected for natural drying (for example best ripe cherries only, a particular field or variety)? |  | Open | 1B |  | Not used in Phase 1A. Keep configurable; do not activate proposed defaults. |
| OC-43 | Moisture is checked during drying. If yes, how often, and with what (moisture meter or by hand)? |  | Open | 1B |  | Not used in Phase 1A. Keep configurable; do not activate proposed defaults. |
| OC-44 | Turning and covering of the coffee (for example during rain) should be recorded. |  | Open | 1B |  | Not used in Phase 1A. Keep configurable; do not activate proposed defaults. |
| OC-45 | Drying floors, trays or beds have their own names or numbers. How many of each? |  | Open | 1B |  | Not used in Phase 1A. Keep configurable; do not activate proposed defaults. |
| OC-46 | Are any other checks done before packing (for example colour, smell, defects, cup tasting)? |  | Open | 1B |  | Not used in Phase 1A. Keep configurable; do not activate proposed defaults. |
| OC-47 | Who confirms that drying is complete and approves the coffee for packing? |  | Open | 1B |  | Not used in Phase 1A. Keep configurable; do not activate proposed defaults. |
| OC-48 | If coffee is not dry enough, it can be sent back for more drying. |  | Open | 1B |  | Not used in Phase 1A. Keep configurable; do not activate proposed defaults. |
| OC-49 | Should photos be taken during drying or checks? |  | Open | 1B |  | Not used in Phase 1A. Keep configurable; do not activate proposed defaults. |

## Packing

| ID | Question | Owner answer | Status | Phase | Blocks production | Interim behaviour |
|---|---|---|---|---|---|---|
| OC-50 | What is packed at the end of this phase: dried parchment coffee, dried cherry, or both? |  | Open | 1B |  | Not used in Phase 1A. Keep configurable; do not activate proposed defaults. |
| OC-51 | Bags have a standard weight. If yes, what weight (for example 50 kg)? |  | Open | 1B |  | Not used in Phase 1A. Keep configurable; do not activate proposed defaults. |
| OC-52 | Should each packed lot have a label, each bag, or both? Lot / Bag / Both |  | Open | 1B |  | Not used in Phase 1A. Keep configurable; do not activate proposed defaults. |
| OC-53 | Is there a label printer at the estate? If yes, please write the model. |  | Open | 1B |  | Not used in Phase 1A. Keep configurable; do not activate proposed defaults. |
| OC-54 | One packed lot can contain coffee from several batches. |  | Open | 1B |  | Not used in Phase 1A. Keep configurable; do not activate proposed defaults. |
| OC-55 | One batch can be packed on different days into different lots. |  | Open | 1B |  | Not used in Phase 1A. Keep configurable; do not activate proposed defaults. |
| OC-56 | Is there a lot numbering format the estate already uses? If yes, please give an example. |  | Open | 1B |  | Not used in Phase 1A. Keep configurable; do not activate proposed defaults. |
| OC-57 | Packing is the last step for now. Storage, sales and delivery will come in later phases. |  | Open | 1B |  | Not used in Phase 1A. Keep configurable; do not activate proposed defaults. |

## Reports and tracing

| ID | Question | Owner answer | Status | Phase | Blocks production | Interim behaviour |
|---|---|---|---|---|---|---|
| OC-58 | The reports listed above are enough to start with. Please add any others you need. |  | Open | 1B |  | Not used in Phase 1A. Keep configurable; do not activate proposed defaults. |
| OC-59 | Should buyers be able to scan the QR label and see basic information about the lot (estate, process, variety, harvest period)? Worker names would never be shown. |  | Open | 1B |  | Not used in Phase 1A. Keep configurable; do not activate proposed defaults. |
| OC-60 | Would you like daily summaries sent to you by SMS, WhatsApp or email? |  | Open | 1B |  | Not used in Phase 1A. Keep configurable; do not activate proposed defaults. |

## People, phones and languages

| ID | Question | Owner answer | Status | Phase | Blocks production | Interim behaviour |
|---|---|---|---|---|---|---|
| OC-61 | There is mobile internet in most fields. |  | Open | 1A |  | Offline capture is always available for attendance, weigh-in and Daily log. |
| OC-62 | There is reliable internet (mobile or Wi-Fi) at the washing, processing and packing area. |  | Open | 1B |  | Processing screens are online-only in Phase 1B until confirmed. |
| OC-63 | Supervisors already have Android smartphones, or the estate will provide them. |  | Open | 1A | Yes | Any current phone browser that can install the web app; tested on Android Chrome and iOS Safari. |
| OC-64 | Which languages should the application show? (for example English, Kannada, Tamil, Malayalam, Hindi) |  | Open | 1A |  | English only. |
| OC-65 | Glazebrooke and Byson Valley will be managed in the same application, under one owner login. |  | Open | 1A |  | Both estates sit in one tenant; an Owner sees both. |
| OC-109 | Is each worker recorded as Permanent, Casual or Contract? | Permanent, Casual or Contract per worker | Confirmed | 1A |  | Optional field on a worker, default Permanent in the form; shown in Masters and on the attendance register; not used in pay or reports. Recorded from the project lead's instruction; the estate owner has not yet answered on the form. |

## Later phases

| ID | Question | Owner answer | Status | Phase | Blocks production | Interim behaviour |
|---|---|---|---|---|---|---|
| OC-66 | It is acceptable for these items to come in later phases. |  | Open | 2 |  | Later-phase scope; nothing activated. |
| OC-67 | Is any of them needed in the first version? If yes, which one and why? |  | Open | 2 |  | Later-phase scope; nothing activated. |

## Estate details and example flow

| ID | Question | Owner answer | Status | Phase | Blocks production | Interim behaviour |
|---|---|---|---|---|---|---|
| OC-68 | Do Glazebrooke and Byson Valley share one washing, fermentation, drying and packing area? If not, please say where each estate processes its coffee. |  | Open | 1B |  | Not used in Phase 1A. Keep configurable; do not activate proposed defaults. |
| OC-69 | Are divisions split into smaller parts (subdivisions) with their own codes, such as SD1 and SD2? If yes, please share the list with the variety and elevation of each. |  | Open | 1A |  | Fields can have optional subdivisions (A, B, C by order) with land use, at most one variety and acres, as in the prototype form (project lead instruction, 28 Oct 2026). Bearing subdivisions need a variety; acres must add up to the field. No codes beyond the letter; weigh-ins are still per field. Meaning and ownership of subdivisions still open (AQ-24). |
| OC-70 | Are cherries from each subdivision kept separate from plucking until packing? |  | Open | 1B |  | Not used in Phase 1A. Keep configurable; do not activate proposed defaults. |
| OC-71 | Orange Kadu is 7 acres, but its varieties add up to 6 acres (3 Chandana Giri and 3 Selection 9). Which is correct, and which variety are the 3 acres of young plants? |  | Open | 1B |  | Not used in Phase 1A. Keep configurable; do not activate proposed defaults. |
| OC-72 | In No 49, are the 8 acres of young plants Chandana Giri and the 2 bearing acres Selection 9? |  | Open | 1B |  | Not used in Phase 1A. Keep configurable; do not activate proposed defaults. |
| OC-73 | Is Chandana Giri the variety also spelled Chandragiri? |  | Open | 1B |  | Not used in Phase 1A. Keep configurable; do not activate proposed defaults. |
| OC-74 | Can you give the elevation of each division or subdivision? |  | Open | 1B |  | Elevation (m) is an optional number on a field, shown only. Not used in Phase 1A logic. |
| OC-75 | Which months does the plucking season run, and is the expected crop updated during the season? |  | Open | 1B |  | Season start is a tenant setting (season.startDate), blank by default; the dashboard and Masters show season totals and progress against each field's expected cherry only when it is set. Staging may set it; production refuses until this is confirmed. Expected cherry per field is typed in Masters. |
| OC-76 | In the example flow, what do the fermentation types GBF1 (Pineapple), GBF2 (Avocado) and GBT1 (Apple) mean? Is fruit added, or is it the flavour aimed for? |  | Open | 1B |  | Not used in Phase 1A. Keep configurable; do not activate proposed defaults. |
| OC-77 | What does the dry type Wats mean in the example flow? |  | Open | 1B |  | Not used in Phase 1A. Keep configurable; do not activate proposed defaults. |
| OC-78 | Can one tank or one tray hold cherries from more than one subdivision or more than one day? |  | Open | 1B |  | Not used in Phase 1A. Keep configurable; do not activate proposed defaults. |
| OC-79 | What do the parts of the item code BROOKAA11 mean (for example BROOK, AA, 11)? |  | Open | 1B |  | Not used in Phase 1A. Keep configurable; do not activate proposed defaults. |
| OC-80 | Are the beans hulled and graded (AA, AB) before packing? Are the small vacuum packs (250 g, 500 g, 1 kg) roasted coffee? |  | Open | 1B |  | Not used in Phase 1A. Keep configurable; do not activate proposed defaults. |
| OC-81 | Is the weight of the coffee recorded when it goes into a tank, onto a tray, and when it comes off? |  | Open | 1B |  | Not used in Phase 1A. Keep configurable; do not activate proposed defaults. |
| OC-82 | Can bags in the same packing lot come from different harvest dates? For example, bag 1 from 1 October only and bag 2 from 1 and 3 October. |  | Open | 1B |  | Not used in Phase 1A. Keep configurable; do not activate proposed defaults. |
| OC-83 | When a pack has coffee from more than one harvest date, should the label show every date (Harvested 1 and 3 Oct 2026) or a date range (Harvested 1 to 3 Oct 2026)? |  | Open | 1B |  | Not used in Phase 1A. Keep configurable; do not activate proposed defaults. |
| OC-84 | Does each worker have a fixed home field, or is the field chosen fresh each day (starting from the day before)? |  | Open | 1A |  | Each day starts from the previous day's field and job (process text, Q1). No fixed home field. |
| OC-85 | Who keeps the lists of fields, workers and jobs up to date: the estate manager, the office, or the owner? |  | Open | 1A |  | Masters are maintained by users holding masters.write (Owner, Estate Manager). |
| OC-86 | Can attendance for a past day be entered or corrected later? If yes, how many days back? |  | Open | 1A | Yes | Supervisors capture only for the current business date. Past days are changed by a correction with a reason by a user holding attendance.correct. |

## New checks and reports

| ID | Question | Owner answer | Status | Phase | Blocks production | Interim behaviour |
|---|---|---|---|---|---|---|
| OC-87 | Empty plucking bags all weigh about the same, so one bag weight per estate is enough. The prototype uses 0.5 kg. What does one empty bag weigh? |  | Open | 1A | Yes | 0.5 kg per bag is a prototype sample and is not used. |
| OC-88 | A small difference between the muster total and the weight at washing is normal. Above 1%, the operator gives a reason. Is 1% the right limit? |  | Open | 1B |  | Not used in Phase 1A. Keep configurable; do not activate proposed defaults. |
| OC-89 | One drying tray holds about 80 kg of cherries. If not, how much does one tray hold? |  | Open | 1B |  | Not used in Phase 1A. Keep configurable; do not activate proposed defaults. |
| OC-90 | A batch is sometimes put on hold (for example, waiting for a repair) or split (for example, moved onto more trays). |  | Open | 1B |  | Not used in Phase 1A. Keep configurable; do not activate proposed defaults. |
| OC-91 | A filled bag may be up to 100 g under its label weight (5 g for a vacuum pack). If not, what limit should apply? |  | Open | 1B |  | Not used in Phase 1A. Keep configurable; do not activate proposed defaults. |
| OC-92 | For outturn (kilograms of cherry per kilogram of dried coffee), which final weight should be used: dried parchment, dried cherry, or clean coffee after hulling? |  | Open | 1B |  | Not used in Phase 1A. Keep configurable; do not activate proposed defaults. |
| OC-93 | Pluckers are paid a rate per kilogram. If yes, what is the rate, and does it change by variety, field or season? |  | Open | 1B |  | Not used in Phase 1A. Keep configurable; do not activate proposed defaults. |
| OC-94 | Who should receive the daily summary on WhatsApp, and at what time of day? |  | Open | 1A |  | Daily summary is shown in the app only; no messages are sent. |
| OC-95 | A fermentation batch may use a mix of flavours with shares that add up to 100% (for example 20%, 60% and 20%). |  | Open | 1B |  | Not used in Phase 1A. Keep configurable; do not activate proposed defaults. |
| OC-96 | When flavours are mixed, the fermentation time is the average of the flavours’ times by share. Is that right, or is the time chosen by hand for each mix? Average / by hand: ______ |  | Open | 1B |  | Not used in Phase 1A. Keep configurable; do not activate proposed defaults. |
| OC-97 | Which fermentation flavours does the estate use, how many hours does each take, and who may change this list? Flavours and hours: ______ |  | Open | 1B |  | Not used in Phase 1A. Keep configurable; do not activate proposed defaults. |
| OC-98 | After pulping, coffee may rest in the same place for about 2 days before drying. Is 2 days right, and where does it rest (for example the pulping floor, in bags or in a tank)? Days: ______ Place: ______ |  | Open | 1B |  | Not used in Phase 1A. Keep configurable; do not activate proposed defaults. |
| OC-99 | Each worker is marked Male or Female. Which tasks or rates depend on it? |  | Open | 1A | Yes | Optional Male/Female field on a worker (project lead instruction, 28 Oct 2026). Shown in Masters and as a women/men count on the attendance register; not used for tasks, pay or rates and not exported to public trace. Estate-owner answer still open. |
| OC-100 | Temperature and rain are recorded twice a day for both estates by the same supervisor, from one place in each estate. Are other readings needed, or other places? |  | Open | 1A | Yes | Daily log kinds are configuration. Temperature (°C) and Rain (mm) twice a day are seeded only in development and staging fixtures; production kinds are created by the tenant admin after confirmation. |
| OC-101 | A supervisor's phone may be without internet for up to 7 days before it needs a full sign-in again. |  | Open | 1A | Yes | Offline capture works while the device session is valid (default 12 hours, configurable). Longer windows up to 7 days are blocked until confirmed. |
| OC-102 | Attendance, Daily log and weigh-in entries made without internet may appear in the office reports only after the phone syncs. Until then the phone shows each entry as waiting. |  | Open | 1A | Yes | Reports count only server-accepted records and show separately how many entries devices reported as waiting. |
| OC-103 | If two supervisors mark the same worker on the same day, the manager decides which entry is kept. |  | Open | 1A | Yes | Two records for the same worker and day become a conflict for a manager to resolve with a reason; both versions are kept. |

## Pepper and Phase 2

| ID | Question | Owner answer | Status | Phase | Blocks production | Interim behaviour |
|---|---|---|---|---|---|---|
| OC-104 | Pepper is grown at Glazebrooke, Byson Valley or both. Which fields or divisions grow pepper? | Answer: the same fields as coffee | Confirmed | 1A |  | Pepper uses the coffee fields; crop is chosen on each weigh-in. |
| OC-105 | Pepper weigh-in works like coffee: worker, field, gross weight, tare and bags, in kilograms. | Yes box ticked; comment: Answer: yes, same fields | Confirmed | 1A |  | Pepper uses the same weigh-in capture as coffee. |
| OC-106 | Pepper is dried until it reaches a target moisture. What is the target, and about how many days does it take? | Answer: light, open drying; the number of days is set. No moisture target. | Confirmed | 1B |  | Pepper route: open drying for a configured number of days, no moisture target. |
| OC-107 | Pepper is packed in bags and delivered to buyers. Each delivery records the buyer, date, number of bags and weight. | Answer: Phase 2 | Confirmed | 2 |  | Deferred to Phase 2. |
| OC-108 | Coffee roasting and delivery: which steps and records are needed (for example roast batch, roast level, weight before and after, delivery to customer)? | Answer: Phase 2 | Confirmed | 2 |  | Deferred to Phase 2. |

## Architecture open questions

| ID | Question | Owner answer | Status | Phase | Blocks production | Interim behaviour |
|---|---|---|---|---|---|---|
| AQ-1 | Who are the tenants, and does an owner need one login across several tenants? | Proposed: Separate companies; one user belongs to one tenant; an owner sees all estates in that tenant | Open | 1A | Yes | One user belongs to one tenant. Cross-tenant login is not built. Blocking for the identity model; interim model documented in ADR-0003. |
| AQ-2 | Technology preference | Proposed: TypeScript, Hono on Cloudflare Workers, React installable web app | Confirmed | 0 |  | Decided 27 October 2026 revision. |
| AQ-3 | Hosting provider, region, budget, residency | Proposed: Cloudflare, existing account | Confirmed | 0 |  | Decided 27 October 2026 revision. Asia-Pacific placement, not India-only residency. |
| AQ-4 | Weigh-in policy: individual, several per day, unit, gross/tare | Proposed: Individual entries in kg, several per day, gross and tare optional | Open | 1A | Yes | See OC-16 to OC-19 and OC-87. Raw gross, bags and tare are stored as entered. |
| AQ-5 | Field/job changes during the day, fixed gangs | Proposed: One field and job per day; optional work groups | Open | 1A | Yes | See OC-5, OC-6 (answered NA, meaning unclear). |
| AQ-6 | Batch mixing, split and merge | Proposed: Mixing allowed with full lineage; split and merge included | Open | 1B | Yes | Blocks Phase 1B batch schema. |
| AQ-23 | Shared processing yard between estates | Proposed: Each estate processes its own coffee | Open | 1B | Yes | Blocks Phase 1B resource model. |
| AQ-24 | Meaning of subdivision and who assigns codes | Proposed: Part of a division by land use and variety; codes generated | Open | 1A | Yes | Subdivision optional in Phase 1A; no generated codes. |
| AQ-25 | Per-worker weighing then combined per subdivision, or per subdivision only | Proposed: Per worker, with subdivision on each entry | Open | 1A | Yes | Per-worker entries; subdivision optional. |
| AQ-30 | Hulling/grading before packing; roasting for vacuum packs | Proposed: No; first version packs dried parchment or cherry only | Open | 1B | Yes | Blocks Phase 1B packing product types. |
