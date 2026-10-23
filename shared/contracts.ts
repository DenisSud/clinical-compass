import { z } from "zod";

export const healthResponse = z.object({
  status: z.literal("ok"),
  db: z.literal("ok"),
  time: z.string(),
});

export type HealthResponse = z.infer<typeof healthResponse>;

export const apiError = z.object({
  code: z.string(),
  message: z.string(),
});

export type ApiError = z.infer<typeof apiError>;

export const credentials = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(200),
});

export type Credentials = z.infer<typeof credentials>;

export const roleSchema = z.enum(["doctor", "patient"]);

export type Role = z.infer<typeof roleSchema>;

export const doctorProfile = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string().nullable(),
  linkCode: z.string().nullable(),
  linkCodeExpiresAt: z.string().nullable(),
});

export const patientProfile = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string().nullable(),
  doctor: z.object({ id: z.string(), email: z.string(), name: z.string().nullable() }).nullable(),
  boundAt: z.string().nullable(),
});

export const meResponse = z.discriminatedUnion("role", [
  z.object({ role: z.literal("doctor"), profile: doctorProfile }),
  z.object({ role: z.literal("patient"), profile: patientProfile }),
]);

export type MeResponse = z.infer<typeof meResponse>;
export type DoctorProfile = z.infer<typeof doctorProfile>;
export type PatientProfile = z.infer<typeof patientProfile>;

export const patientSummary = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string().nullable(),
  boundAt: z.string().nullable(),
});

export type PatientSummary = z.infer<typeof patientSummary>;

export const patientListResponse = z.object({
  patients: z.array(patientSummary),
});

export type PatientListResponse = z.infer<typeof patientListResponse>;
