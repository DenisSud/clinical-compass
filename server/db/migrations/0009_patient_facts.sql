-- Факты, блокирующие решение. Перечень взят из ОХЛП «Авиандр» (ЛП-№(002445)-(РГ-RU)), раздел 4.3.
-- NULL означает «не спрашивали», а не «нет»: правило не имеет права срабатывать на неизвестном.
CREATE TABLE patient_facts (
  patient_id TEXT PRIMARY KEY REFERENCES patients(id) ON DELETE CASCADE,
  epilepsy_or_organic_brain_disease TEXT CHECK (epilepsy_or_organic_brain_disease IN ('yes', 'no')),
  mao_inhibitors TEXT CHECK (mao_inhibitors IN ('none', 'current', 'stopped_under_2_weeks')),
  egfr_ml_min INTEGER CHECK (egfr_ml_min BETWEEN 0 AND 200),
  child_pugh TEXT CHECK (child_pugh IN ('A', 'B', 'C')),
  pregnancy TEXT CHECK (pregnancy IN ('not_applicable', 'no', 'pregnant', 'lactating')),
  galactose_intolerance TEXT CHECK (galactose_intolerance IN ('yes', 'no')),
  updated_at TEXT NOT NULL
);
