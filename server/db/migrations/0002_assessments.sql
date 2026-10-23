CREATE TABLE assessments (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  instrument_id TEXT NOT NULL,
  instrument_version TEXT NOT NULL,
  answers TEXT NOT NULL,
  total_score INTEGER NOT NULL,
  band_id TEXT NOT NULL,
  band_label TEXT NOT NULL,
  submission_id TEXT NOT NULL,
  submitted_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_assessments_submission ON assessments(patient_id, submission_id);
CREATE INDEX idx_assessments_patient ON assessments(patient_id, submitted_at);
