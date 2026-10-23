import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
