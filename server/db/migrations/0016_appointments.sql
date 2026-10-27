-- Приём у психиатра (SPEC S24, decisions.md Q49): следующий приём назначает сам
-- психиатр из карточки пациента. Запись не удаляется, а отменяется датой: история
-- приёмов остаётся, поэтому «отменён» — это поле, а не отсутствие строки.
CREATE TABLE appointments (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  -- Ведущий врач на момент записи. NULL — врач удалён; приём от этого не исчезает.
  doctor_id TEXT REFERENCES doctors(id) ON DELETE SET NULL,
  -- ISO-время с зоной: «следующий приём» и сутки до него считаются от текущего момента.
  scheduled_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  cancelled_at TEXT
);

-- Один индекс на оба вопроса: приёмы пациента и ближайший из них по времени.
CREATE INDEX idx_appointments_patient ON appointments(patient_id, scheduled_at);

-- Напоминание на почту пациент включает по желанию (S24, Q49). Это согласие, а не
-- факт отправки: почтовой отправки в продукте нет, и колонка об этом не врёт.
ALTER TABLE patients ADD COLUMN remind_by_email INTEGER NOT NULL DEFAULT 0
  CHECK (remind_by_email IN (0, 1));
