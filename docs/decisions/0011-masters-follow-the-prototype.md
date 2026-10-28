# ADR-0011: Masters forms follow the prototype

- Status: Interim, 28 October 2026
- Source: project lead instruction in the build session (screenshots of the prototype's New worker, New field, Jobs, Log kinds and Users pages)
- Approver: Muthu Kumar (project lead). The estate owner has not yet confirmed the items marked open below.

## Decision

The Masters and Users screens follow the prototype's forms and tables:

- **Worker:** estate, name, optional gender (Male or Female), type (Permanent, Casual or Contract; OC-109 confirmed by the project lead) and status. The employee code is allocated by the server (`GLZ-001`). Gender is optional and display-only (attendance count of women and men); OC-99 stays open for any use in tasks or rates.
- **Field:** name, total acres, expected cherry this season (kg, stored as grams), elevation (m), status and subdivisions A, B, C. A subdivision has one land use (Bearing, Young plants, Rock, Water, Empty, Other crop), at most one variety and acres. Bearing needs a variety and the acres must add up to the field, as in the prototype. The field's varieties follow from its subdivisions. The field code is allocated by the server (`GLZ-01`) when not given. Subdivision meaning, codes and ownership stay open (AQ-24, OC-69); elevation and expected crop are display-only (OC-74, OC-75).
- **Job:** code, name, and "counts as plucking". The flag is stored and shown but weigh-in does not yet depend on it; making weigh-in follow it needs an owner decision.
- **Log kind:** adds optional "expected per day", shown only. The reading list itself is still OC-100.
- **Users:** the prototype's table with role chips, estates, last sign-in (newest session) and status.

All additions are optional columns or a new table (tenant migration 0002), so existing rows stay valid. Weigh-ins remain per field; subdivision is not on a weigh-in.

- **Delete:** a worker or field can be deleted only while nothing refers to it (no attendance or weigh-in record), with a reason in the audit trail. Anything used is set Inactive, never deleted, so history keeps its names. Jobs, varieties and log kinds are never deleted. CSV import never deletes.

- **Manager access:** the Estate Manager manages the shared lists, settings and users for the estates they manage (project lead instruction, 28 October 2026). Owner-only: the Owner role, recording go-live answers and the readiness list.

## Consequences

- Items still open with the estate: OC-99 (gender use), AQ-24 and OC-69 (subdivisions), OC-74 and OC-75 (elevation, expected crop), OC-100 (log kinds).
- Worker types are Permanent, Casual, Contract and North Indian (the estate records North Indian beside Permanent in its daily sheet, 28 October 2026). A worker also has an optional Area (where the worker comes from). Tenant migration 0003 widens the type and adds the area.
- Importing workers accepts optional `employment_type`, `area` and `gender` columns; fields import is unchanged and does not touch subdivisions.
