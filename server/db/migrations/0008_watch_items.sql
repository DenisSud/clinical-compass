CREATE TABLE IF NOT EXISTS watch_items (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  doctor_id TEXT REFERENCES doctors(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  severity TEXT NOT NULL,
  params TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  paused_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_watch_patient ON watch_items(patient_id, status);

-- A signal raised by the doctor's own rule names that rule. Empty string rather than
-- NULL: SQLite treats NULLs as distinct in a unique index, and the dedupe below has to
-- work for the built-in rules too.
ALTER TABLE signals ADD COLUMN watch_item_id TEXT NOT NULL DEFAULT '';

DROP INDEX IF EXISTS idx_signals_source;
CREATE UNIQUE INDEX IF NOT EXISTS idx_signals_source
  ON signals(source_type, source_id, kind, watch_item_id);
