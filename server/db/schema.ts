import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const doctors = sqliteTable("doctors", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name"),
  /**
   * Специальность врача задаёт этап пациента: у терапевта скрининг, у психиатра
   * терапия (Q49). Это поле врача, а не вторая роль.
   */
  specialty: text("specialty", { enum: ["therapist", "psychiatrist"] })
    .notNull()
    .default("therapist"),
  bindingCode: text("binding_code").unique(),
  bindingCodeExpiresAt: text("binding_code_expires_at"),
  createdAt: text("created_at").notNull(),
});

export const patients = sqliteTable(
  "patients",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    name: text("name"),
    doctorId: text("doctor_id").references(() => doctors.id, { onDelete: "set null" }),
    boundAt: text("bound_at"),
    /**
     * Этап пациента, а не оценка тяжести. Выводится из специальности ведущего врача
     * при привязке (SPEC S3, Q49) и выбирает набор опросников из
     * content/instrument-statuses.json. Пациенту не показывается.
     */
    status: text("status", { enum: ["screening", "treatment"] })
      .notNull()
      .default("screening"),
    createdAt: text("created_at").notNull(),
    /**
     * Согласие на напоминание о приёме по почте (SPEC S24, Q49). Хранится как
     * предпочтение пациента: отправки в продукте пока нет, и поле об этом не врёт.
     */
    remindByEmail: integer("remind_by_email", { mode: "boolean" }).notNull().default(false),
  },
  (table) => [index("idx_patients_doctor_id").on(table.doctorId)],
);

/**
 * Факты, блокирующие решение. Источник перечня — ОХЛП «Авиандр», раздел 4.3.
 * NULL = не спрашивали; это не «нет». Правило, которое не отличает одно от другого,
 * превращает пропуск в ответ.
 */
export const patientFacts = sqliteTable("patient_facts", {
  patientId: text("patient_id")
    .primaryKey()
    .references(() => patients.id, { onDelete: "cascade" }),
  epilepsyOrOrganicBrainDisease: text("epilepsy_or_organic_brain_disease", {
    enum: ["yes", "no"],
  }),
  maoInhibitors: text("mao_inhibitors", {
    enum: ["none", "current", "stopped_under_2_weeks"],
  }),
  /** Дробная с одним знаком: значение из анализа приходит как 59.6 (#52). */
  egfrMlMin: real("egfr_ml_min"),
  childPugh: text("child_pugh", { enum: ["A", "B", "C", "none"] }),
  pregnancy: text("pregnancy", {
    enum: ["not_applicable", "no", "pregnant", "lactating"],
  }),
  galactoseIntolerance: text("galactose_intolerance", { enum: ["yes", "no"] }),
  updatedAt: text("updated_at").notNull(),
});

export const sessions = sqliteTable(
  "sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    role: text("role", { enum: ["doctor", "patient"] }).notNull(),
    userId: text("user_id").notNull(),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("idx_sessions_user").on(table.userId)],
);

export const assessments = sqliteTable(
  "assessments",
  {
    id: text("id").primaryKey(),
    patientId: text("patient_id")
      .notNull()
      .references(() => patients.id, { onDelete: "cascade" }),
    instrumentId: text("instrument_id").notNull(),
    instrumentVersion: text("instrument_version").notNull(),
    answers: text("answers").notNull(),
    totalScore: integer("total_score").notNull(),
    bandId: text("band_id").notNull(),
    bandLabel: text("band_label").notNull(),
    submissionId: text("submission_id").notNull(),
    submittedAt: text("submitted_at").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_assessments_submission").on(table.patientId, table.submissionId),
    index("idx_assessments_patient").on(table.patientId, table.submittedAt),
  ],
);

export const diaryEntries = sqliteTable(
  "diary_entries",
  {
    id: text("id").primaryKey(),
    patientId: text("patient_id")
      .notNull()
      .references(() => patients.id, { onDelete: "cascade" }),
    entryDate: text("entry_date").notNull(),
    value: integer("value").notNull(),
    comment: text("comment"),
    submissionId: text("submission_id").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_diary_submission").on(table.patientId, table.submissionId),
    uniqueIndex("idx_diary_day").on(table.patientId, table.entryDate),
  ],
);

export const signals = sqliteTable(
  "signals",
  {
    id: text("id").primaryKey(),
    patientId: text("patient_id")
      .notNull()
      .references(() => patients.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    severity: text("severity").notNull(),
    title: text("title").notNull(),
    detail: text("detail").notNull(),
    sourceType: text("source_type").notNull(),
    sourceId: text("source_id").notNull(),
    status: text("status").notNull(),
    outcome: text("outcome"),
    createdAt: text("created_at").notNull(),
    takenAt: text("taken_at"),
    closedAt: text("closed_at"),
    watchItemId: text("watch_item_id").notNull().default(""),
    ruleId: text("rule_id").notNull().default(""),
  },
  (table) => [
    uniqueIndex("idx_signals_source").on(
      table.sourceType,
      table.sourceId,
      table.kind,
      table.watchItemId,
    ),
    index("idx_signals_patient").on(table.patientId, table.status),
  ],
);

/**
 * Правило, которое врач написал для одного пациента. Встроенные правила работают всегда,
 * их нельзя выключить, эти идут в дополнение. Их ставят на паузу, но не удаляют: сигнал
 * может на них ссылаться.
 */
export const watchItems = sqliteTable(
  "watch_items",
  {
    id: text("id").primaryKey(),
    patientId: text("patient_id")
      .notNull()
      .references(() => patients.id, { onDelete: "cascade" }),
    doctorId: text("doctor_id").references(() => doctors.id, { onDelete: "set null" }),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    severity: text("severity").notNull(),
    params: text("params").notNull(),
    status: text("status").notNull(),
    createdAt: text("created_at").notNull(),
    pausedAt: text("paused_at"),
  },
  (table) => [index("idx_watch_patient").on(table.patientId, table.status)],
);

export const planItems = sqliteTable(
  "plan_items",
  {
    id: text("id").primaryKey(),
    patientId: text("patient_id")
      .notNull()
      .references(() => patients.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    details: text("details"),
    status: text("status").notNull(),
    createdAt: text("created_at").notNull(),
    confirmedAt: text("confirmed_at"),
    archivedAt: text("archived_at"),
  },
  (table) => [index("idx_plan_patient").on(table.patientId, table.status)],
);

export const planCheckins = sqliteTable(
  "plan_checkins",
  {
    id: text("id").primaryKey(),
    planItemId: text("plan_item_id")
      .notNull()
      .references(() => planItems.id, { onDelete: "cascade" }),
    patientId: text("patient_id")
      .notNull()
      .references(() => patients.id, { onDelete: "cascade" }),
    checkinDate: text("checkin_date").notNull(),
    status: text("status").notNull(),
    reason: text("reason"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_checkins_item_day").on(table.planItemId, table.checkinDate),
    index("idx_checkins_patient").on(table.patientId, table.checkinDate),
  ],
);

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    patientId: text("patient_id")
      .notNull()
      .references(() => patients.id, { onDelete: "cascade" }),
    authorRole: text("author_role").notNull(),
    body: text("body").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("idx_messages_patient").on(table.patientId, table.createdAt)],
);

/**
 * Назначение препарата: препарат, доза, расписание и даты. `drug_id` — ссылка на
 * справочник корпуса (`server/knowledge`), а не на таблицу: справочник — файл, и
 * свободный текст рядом нужен для препарата, которого в справочнике ещё нет.
 * `times_of_day` — JSON-массив «ЧЧ:ММ»; `times_per_day` обязан совпадать с его длиной,
 * это проверяет и схема, и CHECK в миграции.
 */
export const prescriptions = sqliteTable(
  "prescription",
  {
    id: text("id").primaryKey(),
    patientId: text("patient_id")
      .notNull()
      .references(() => patients.id, { onDelete: "cascade" }),
    drugId: text("drug_id"),
    drugName: text("drug_name").notNull(),
    doseValue: real("dose_value").notNull(),
    doseUnit: text("dose_unit").notNull(),
    timesPerDay: integer("times_per_day").notNull(),
    timesOfDay: text("times_of_day").notNull(),
    startsOn: text("starts_on").notNull(),
    endsOn: text("ends_on"),
    status: text("status").notNull(),
    createdAt: text("created_at").notNull(),
    confirmedAt: text("confirmed_at"),
    confirmedBy: text("confirmed_by").references(() => doctors.id, { onDelete: "set null" }),
    archivedAt: text("archived_at"),
  },
  (table) => [index("idx_prescriptions_patient").on(table.patientId, table.status)],
);

/**
 * Приём, назначенный психиатром (SPEC S24, Q49). Отмена — дата в `cancelled_at`, а не
 * удаление строки: история приёмов нужна врачу, а «следующий приём» — это единственная
 * неудалённая и неотменённая запись в будущем.
 */
export const appointments = sqliteTable(
  "appointments",
  {
    id: text("id").primaryKey(),
    patientId: text("patient_id")
      .notNull()
      .references(() => patients.id, { onDelete: "cascade" }),
    /** Ведущий врач на момент записи; NULL — врач удалён, приём остаётся. */
    doctorId: text("doctor_id").references(() => doctors.id, { onDelete: "set null" }),
    /** ISO-время с зоной: и «следующий приём», и сутки до него считаются от момента. */
    scheduledAt: text("scheduled_at").notNull(),
    createdAt: text("created_at").notNull(),
    cancelledAt: text("cancelled_at"),
  },
  (table) => [index("idx_appointments_patient").on(table.patientId, table.scheduledAt)],
);

/**
 * Событие приёма по конкретному запланированному времени, а не «отметка за сегодня»:
 * пропуск — это разница между запланированным и фактическим временем. Нет строки —
 * не «принял» и не «пропустил», а «не спрашивали».
 */
export const doseEvents = sqliteTable(
  "dose_event",
  {
    id: text("id").primaryKey(),
    prescriptionId: text("prescription_id")
      .notNull()
      .references(() => prescriptions.id, { onDelete: "cascade" }),
    patientId: text("patient_id")
      .notNull()
      .references(() => patients.id, { onDelete: "cascade" }),
    scheduledAt: text("scheduled_at").notNull(),
    status: text("status").notNull(),
    takenAt: text("taken_at"),
    reason: text("reason"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_dose_events_slot").on(table.prescriptionId, table.scheduledAt),
    index("idx_dose_events_patient").on(table.patientId, table.scheduledAt),
  ],
);
