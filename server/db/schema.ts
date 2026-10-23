import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const doctors = sqliteTable("doctors", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name"),
  linkCode: text("link_code").unique(),
  linkCodeExpiresAt: text("link_code_expires_at"),
  createdAt: text("created_at").notNull(),
});

export const patients = sqliteTable("patients", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name"),
  doctorId: text("doctor_id").references(() => doctors.id),
  boundAt: text("bound_at"),
  createdAt: text("created_at").notNull(),
});

export const sessions = sqliteTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  role: text("role", { enum: ["doctor", "patient"] }).notNull(),
  userId: text("user_id").notNull(),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull(),
});
