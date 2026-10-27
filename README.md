# CEMMS: Coffee Estate Operations

CEMMS is a multi-tenant web and mobile application for coffee estates. It covers the daily work from morning attendance through plucking (evening muster), washing and sorting, the three processing routes, and packing, with every packed bag traceable back to its harvest dates, divisions, subdivisions and workers.

The first tenant runs two estates, Glazebrooke and Byson Valley.

## Status

| Area | State |
|---|---|
| Architecture and technical design | Revised 27 October 2026 for Cloudflare and a phased go-live; some owner answers still open |
| Owner process confirmation | Sent to the estate owner; answers coming in |
| Clickable prototype | Ready for owner review (this repository) |
| Application code | Starting 28 October 2026; Phase 1A (attendance, Daily log, weigh-in) goes live 1 November 2026 |

## Prototype

`prototype/index.html` is a single-file clickable prototype. Open it in any modern browser; it needs an internet connection only for fonts and the QR code library.

- **Supervisor phone:** attendance roll call, field and job assignment, evening muster with a weight keypad, number of bags and an optional remark, and offline capture with sync.
- **Estate portal:** dashboard, attendance register (Present, Half day, Absent, Leave, Off day, Holiday; each worker is Male or Female; reopening needs a reason), plucking, washing lots with the weight at washing checked against the muster, the processing board for Routes A (Pulping), B (Fermentation) and C (Natural) with trays picked by hand, an optional rest in place of about 2 days after pulping (with a countdown timer), fermentation with one flavour or a mix of flavours (for example 20%, 60% and 20%, with a target time that is the average by share, and flavours and times the Admin can edit in Process settings), a drying log, hold and split, quality check, packing into bags with labels and a weight check on every bag, and bag tracing.
- **Sign-in and roles:** Admin sees every screen and the Users page; Supervisor sees the dashboard, attendance, plucking and the daily log. Sample password for every user: `welcome`.
- **Daily log:** readings for both estates (temperature, rain, fermentation room temperature) with the date, time, estate, kind, data and remarks, on the portal and the phone app. Admin adds new kinds under Masters.
- **Reports:** a daily summary ready to paste into WhatsApp, outturn by route, variety and field, and plucker productivity with a pay preview.

Divisions, acres, varieties and expected crop are the real Glazebrooke and Byson Valley figures. Workers, weights, batches and bags are sample data, kept only in the viewer's browser. The clock shows the real time and the sample data is dated to today. Use **Reset** to start the sample again.

To see a bag that holds two harvest dates, open **Trace a bag** and look up `BROOKAA13`.

## Planned stack

TypeScript throughout, hosted only on Cloudflare: a Hono API on Workers; one SQLite database per tenant in a Durable Object, plus a D1 control database for tenants, users and sessions; R2 for files and nightly backups; Queues and Cron Triggers for background work. The portal and the supervisor phone app are one React (Vite) installable web app that works offline with IndexedDB. A native Android app comes later. Production will be at estate.oneuptech.co. The full reasoning is in the architecture document, which lives in Google Drive.

## Phases

- **Phase 1A, live 1 November 2026:** sign-in and roles, estates, fields (Coffee or Pepper), workers, CSV import, Attendance, Weigh-in, Daily log, offline sync.
- **Phase 1B:** washing, processing (Routes A, B and C), packing, tracing and reports; Pepper normal drying, packing and delivery.
- **Phase 2:** roasting and delivery.
