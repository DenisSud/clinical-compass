CREATE TABLE IF NOT EXISTS plan_checkins (
  id TEXT PRIMARY KEY,
  plan_item_id TEXT NOT NULL REFERENCES plan_items(id) ON DELETE CASCADE,
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  checkin_date TEXT NOT NULL,
  status TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_checkins_item_day ON plan_checkins(plan_item_id, checkin_date);
CREATE INDEX IF NOT EXISTS idx_checkins_patient ON plan_checkins(patient_id, checkin_date);
