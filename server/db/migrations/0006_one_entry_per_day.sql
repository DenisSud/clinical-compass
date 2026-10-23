DELETE FROM diary_entries
WHERE rowid NOT IN (
  SELECT MIN(rowid) FROM diary_entries GROUP BY patient_id, entry_date
);

CREATE UNIQUE INDEX idx_diary_day ON diary_entries(patient_id, entry_date);
