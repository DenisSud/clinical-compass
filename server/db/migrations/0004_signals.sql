CREATE TABLE signals (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  severity TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  status TEXT NOT NULL,
  outcome TEXT,
  created_at TEXT NOT NULL,
  taken_at TEXT,
  closed_at TEXT
);

CREATE UNIQUE INDEX idx_signals_source ON signals(source_type, source_id, kind);
CREATE INDEX idx_signals_patient ON signals(patient_id, status);
