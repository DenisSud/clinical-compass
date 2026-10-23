CREATE TABLE diary_entries (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  entry_date TEXT NOT NULL,
  value INTEGER NOT NULL,
  comment TEXT,
  submission_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_diary_submission ON diary_entries(patient_id, submission_id);
CREATE INDEX idx_diary_patient ON diary_entries(patient_id, entry_date);
