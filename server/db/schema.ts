import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const doctors = sqliteTable("doctors", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name"),
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
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("idx_patients_doctor_id").on(table.doctorId)],
);

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
    index("idx_diary_patient").on(table.patientId, table.entryDate),
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
  },
  (table) => [
    uniqueIndex("idx_signals_source").on(table.sourceType, table.sourceId, table.kind),
    index("idx_signals_patient").on(table.patientId, table.status),
  ],
);
