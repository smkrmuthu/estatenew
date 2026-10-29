/**
 * Tare is one value for every estate (a setting), not a column per estate (ADR-0021 replaces ADR-0019's
 * per-estate value). Any figure already set on an estate is kept as the setting, then the column goes.
 */
export default `
INSERT OR IGNORE INTO settings (key, value_json, basis, version, updated_at, updated_by)
  SELECT 'muster.tare.defaultGrams', CAST(MAX(default_tare_g) AS TEXT), 'tenant-choice', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'migration-0008'
  FROM estates HAVING MAX(default_tare_g) > 0;
ALTER TABLE estates DROP COLUMN default_tare_g;
`;
