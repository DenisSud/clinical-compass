-- Назначение и таблетница (decisions.md Q32). Две сущности, один источник:
-- `prescription` — препарат, доза, расписание, даты и подтверждение врачом;
-- `dose_event` — отметка пациента по конкретному запланированному времени.
-- Таблетница — представление поверх этих двух таблиц, отдельной таблицы у неё нет.

CREATE TABLE prescription (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  -- Ссылка на справочник корпуса (server/knowledge, id документа). NULL — препарата
  -- в справочнике нет, и тогда единственный источник названия — свободный текст.
  drug_id TEXT,
  drug_name TEXT NOT NULL,
  dose_value REAL NOT NULL CHECK (dose_value > 0),
  dose_unit TEXT NOT NULL,
  times_per_day INTEGER NOT NULL CHECK (times_per_day BETWEEN 1 AND 6),
  -- JSON-массив «ЧЧ:ММ». Расписание живёт здесь одно: разы в день — это его длина.
  times_of_day TEXT NOT NULL CHECK (json_valid(times_of_day)),
  starts_on TEXT NOT NULL,
  -- NULL — курс открыт: ОХЛП «Авиандр» оставляет длительность на врача.
  ends_on TEXT,
  status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'archived')),
  created_at TEXT NOT NULL,
  confirmed_at TEXT,
  confirmed_by TEXT REFERENCES doctors(id) ON DELETE SET NULL,
  archived_at TEXT,
  CHECK (ends_on IS NULL OR ends_on >= starts_on),
  CHECK (json_array_length(times_of_day) = times_per_day)
);

CREATE INDEX idx_prescriptions_patient ON prescription(patient_id, status);

CREATE TABLE dose_event (
  id TEXT PRIMARY KEY,
  prescription_id TEXT NOT NULL REFERENCES prescription(id) ON DELETE CASCADE,
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  -- Запланированное время приёма, настенные «ГГГГ-ММ-ДДTЧЧ:ММ»: перевод часов
  -- не сдвигает расписание, а сравнение строк задаёт порядок приёмов.
  scheduled_at TEXT NOT NULL,
  -- Отсутствие строки значит «не спрашивали», а не «принял»: три состояния
  -- названы явно, чтобы «нет данных» нельзя было прочитать как благополучие.
  status TEXT NOT NULL CHECK (status IN ('taken', 'skipped', 'no_data')),
  taken_at TEXT,
  reason TEXT,
  created_at TEXT NOT NULL,
  CHECK (status <> 'taken' OR taken_at IS NOT NULL),
  CHECK (status <> 'skipped' OR reason IS NOT NULL)
);

-- Один приём — одна отметка: повторный тап исправляет запись, а не заводит вторую.
CREATE UNIQUE INDEX idx_dose_events_slot ON dose_event(prescription_id, scheduled_at);
CREATE INDEX idx_dose_events_patient ON dose_event(patient_id, scheduled_at);
