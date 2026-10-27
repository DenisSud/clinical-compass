-- Статус пациента выбирает набор опросников (content/instrument-statuses.json, issue #68).
-- Столбец аддитивный, с умолчанием: существующие пациенты остаются на скрининге, данные не
-- пересобираются. CHECK перечисляет статусы, чтобы опечатка в коде падала на записи, а не
-- превращалась в пустой список опросников.
ALTER TABLE patients ADD COLUMN status TEXT NOT NULL DEFAULT 'screening'
  CHECK (status IN ('screening', 'treatment', 'worsening'));
