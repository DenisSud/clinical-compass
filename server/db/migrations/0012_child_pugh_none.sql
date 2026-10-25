-- «Нет» на вопрос о Чайлд-Пью — это ответ, а не отсутствие ответа: иначе врач не отличает
-- «спросили, недостаточности нет» от «не спрашивали», и оба выглядят одинаково (#48).
-- SQLite не меняет CHECK на месте, поэтому таблица пересобирается.
CREATE TABLE patient_facts_new (
  patient_id TEXT PRIMARY KEY REFERENCES patients(id) ON DELETE CASCADE,
  epilepsy_or_organic_brain_disease TEXT CHECK (epilepsy_or_organic_brain_disease IN ('yes', 'no')),
  mao_inhibitors TEXT CHECK (mao_inhibitors IN ('none', 'current', 'stopped_under_2_weeks')),
  egfr_ml_min INTEGER CHECK (egfr_ml_min BETWEEN 0 AND 200),
  child_pugh TEXT CHECK (child_pugh IN ('A', 'B', 'C', 'none')),
  pregnancy TEXT CHECK (pregnancy IN ('not_applicable', 'no', 'pregnant', 'lactating')),
  galactose_intolerance TEXT CHECK (galactose_intolerance IN ('yes', 'no')),
  updated_at TEXT NOT NULL
);
INSERT INTO patient_facts_new SELECT patient_id, epilepsy_or_organic_brain_disease, mao_inhibitors, egfr_ml_min, child_pugh, pregnancy, galactose_intolerance, updated_at FROM patient_facts;
DROP TABLE patient_facts;
ALTER TABLE patient_facts_new RENAME TO patient_facts;
