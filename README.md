# CEMMS: Coffee Estate Operations

CEMMS is a multi-tenant web and mobile application for coffee estates. It covers the daily work from morning attendance through plucking (evening muster), washing and sorting, the three processing routes, and packing, with every packed bag traceable back to its harvest dates, divisions, subdivisions and workers.

The first tenant runs two estates, Glazebrooke and Byson Valley.

## Status

| Area | State |
|---|---|
| Architecture and technical design | Draft, waiting on owner answers to the open questions |
| Owner process confirmation | Sent to the estate owner; answers coming in |
| Clickable prototype | Ready for owner review (this repository) |
| Application code | Not started |

## Prototype

`prototype/index.html` is a single-file clickable prototype. Open it in any modern browser; it needs an internet connection only for fonts and the QR code library.

- **Supervisor phone:** attendance roll call, field and job assignment, evening muster with a weight keypad, and offline capture with sync.
- **Estate portal:** dashboard, attendance approval, plucking, washing lots, the processing board for Routes A (Pulping), B (Fermentation) and C (Natural), quality check, packing into bags with labels, and bag tracing.

Divisions, acres, varieties and expected crop are the real Glazebrooke and Byson Valley figures. Workers, weights, batches and bags are sample data, kept only in the viewer's browser. Use **Reset sample data** to start again, and **+6 h** or **+1 day** to move the sample clock forward.

To see a bag that holds two harvest dates, open **Trace a bag** and look up `BROOKAA13`.

## Planned stack

TypeScript throughout: NestJS API, Next.js web portal, React Native (Expo) field app with offline SQLite, and PostgreSQL with row-level security for tenant isolation. The full reasoning is in the architecture document, which lives in Google Drive.
