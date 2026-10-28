/**
 * Workers get an area (where the worker comes from) and a fourth type, North Indian, which the estate
 * records next to Permanent in its daily sheet. SQLite cannot widen a CHECK in place, so the column is
 * replaced: add the wider one, copy, drop the old, rename. Existing rows keep their type.
 */
export default `
ALTER TABLE workers ADD COLUMN employment_type_v3 TEXT CHECK (employment_type_v3 IN ('PERMANENT', 'CASUAL', 'CONTRACT', 'NORTH_INDIAN'));
UPDATE workers SET employment_type_v3 = employment_type;
ALTER TABLE workers DROP COLUMN employment_type;
ALTER TABLE workers RENAME COLUMN employment_type_v3 TO employment_type;
ALTER TABLE workers ADD COLUMN area TEXT;
`;
