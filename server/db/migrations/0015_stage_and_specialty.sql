-- Этап пациента следует из специальности ведущего врача (Q49), третьего этапа
-- «ухудшение» больше нет. Специальность аддитивна: умолчание «терапевт», потому
-- что скрининг это точка входа, а психиатра выбирают явно при регистрации.
ALTER TABLE doctors ADD COLUMN specialty TEXT NOT NULL DEFAULT 'therapist'
  CHECK (specialty IN ('therapist', 'psychiatrist'));

ALTER TABLE patients ADD COLUMN status TEXT NOT NULL DEFAULT 'screening'
  CHECK (status IN ('screening', 'treatment'));
