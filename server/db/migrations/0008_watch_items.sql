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

-- Сигнал, поднятый правилом врача, называет это правило. Пустая строка вместо NULL:
-- SQLite считает NULL-ы различными в уникальном индексе, а дедупликация ниже должна
-- работать и для встроенных правил.
ALTER TABLE signals ADD COLUMN watch_item_id TEXT NOT NULL DEFAULT '';

DROP INDEX IF EXISTS idx_signals_source;
CREATE UNIQUE INDEX IF NOT EXISTS idx_signals_source
  ON signals(source_type, source_id, kind, watch_item_id);
