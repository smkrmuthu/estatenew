/**
 * Master data the prototype's forms carry: worker gender and type, field elevation, expected cherry and
 * subdivisions, whether a job counts as plucking, and expected readings per day for a Daily log kind.
 * All optional or defaulted, so existing rows stay valid. Gender and subdivisions still wait on OC-99 and AQ-24.
 */
export default `
ALTER TABLE workers ADD COLUMN gender TEXT CHECK (gender IN ('MALE', 'FEMALE'));
ALTER TABLE workers ADD COLUMN employment_type TEXT CHECK (employment_type IN ('PERMANENT', 'CASUAL', 'CONTRACT'));
ALTER TABLE fields ADD COLUMN elevation_m INTEGER;
ALTER TABLE fields ADD COLUMN expected_cherry_g INTEGER;
ALTER TABLE job_types ADD COLUMN counts_as_plucking INTEGER NOT NULL DEFAULT 0;
ALTER TABLE log_kinds ADD COLUMN expected_per_day INTEGER;

CREATE TABLE field_subdivisions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  field_id TEXT NOT NULL REFERENCES fields(id),
  label TEXT NOT NULL,
  land_use TEXT NOT NULL CHECK (land_use IN ('BEARING', 'YOUNG', 'ROCK', 'WATER', 'EMPTY', 'OTHER_CROP')),
  variety_id TEXT REFERENCES varieties(id),
  area_centi_acres INTEGER,
  UNIQUE (field_id, label)
);
CREATE INDEX field_subdivisions_field ON field_subdivisions(field_id);
`;
