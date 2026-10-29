/**
 * Each estate has a default tare in grams, set by a manager or owner and applied to every weigh-in
 * a supervisor records. It starts at 0, so weigh-ins behave as before until someone sets it.
 */
export default `
ALTER TABLE estates ADD COLUMN default_tare_g INTEGER NOT NULL DEFAULT 0;
`;
