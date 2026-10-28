/**
 * Each worker is allotted to the estates they work in (a table instead of the all_estates flag, so the
 * estate manager chooses estates per worker in Masters). Existing workers keep their home estate, and
 * workers flagged for all estates are allotted to every estate. The old all_estates column stays unused.
 */
export default `
CREATE TABLE worker_estates (
  worker_id TEXT NOT NULL REFERENCES workers(id),
  estate_id TEXT NOT NULL REFERENCES estates(id),
  tenant_id TEXT NOT NULL,
  PRIMARY KEY (worker_id, estate_id)
);
CREATE INDEX worker_estates_estate ON worker_estates(estate_id);
INSERT INTO worker_estates (worker_id, estate_id, tenant_id) SELECT id, estate_id, tenant_id FROM workers;
INSERT OR IGNORE INTO worker_estates (worker_id, estate_id, tenant_id)
  SELECT w.id, e.id, w.tenant_id FROM workers w CROSS JOIN estates e WHERE w.all_estates = 1;
`;
