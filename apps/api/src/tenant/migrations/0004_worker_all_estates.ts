/**
 * A worker can be marked as working in all of the tenant's estates (the same people work in both
 * Glazebrooke and Byson Valley). The worker keeps a home estate for ownership and permissions; the flag
 * only decides where the worker appears in registers and weigh-in. Existing workers stay on their estate.
 */
export default `
ALTER TABLE workers ADD COLUMN all_estates INTEGER NOT NULL DEFAULT 0 CHECK (all_estates IN (0, 1));
`;
