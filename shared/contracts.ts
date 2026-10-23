import { z } from "zod";

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  db: z.literal("ok"),
  time: z.string(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const apiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
});

export type ApiErrorBody = z.infer<typeof apiErrorSchema>;

export const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(200),
});

export type Credentials = z.infer<typeof credentialsSchema>;

export const roleSchema = z.enum(["doctor", "patient"]);

export type Role = z.infer<typeof roleSchema>;

export const doctorProfileSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string().nullable(),
  bindingCode: z.string().nullable(),
  bindingCodeExpiresAt: z.string().nullable(),
});

export type DoctorProfile = z.infer<typeof doctorProfileSchema>;

export const patientProfileSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string().nullable(),
  doctor: z.object({ id: z.string(), email: z.string(), name: z.string().nullable() }).nullable(),
  boundAt: z.string().nullable(),
});

export type PatientProfile = z.infer<typeof patientProfileSchema>;

export const meResponseSchema = z.discriminatedUnion("role", [
  z.object({ role: z.literal("doctor"), profile: doctorProfileSchema }),
  z.object({ role: z.literal("patient"), profile: patientProfileSchema }),
]);

export type MeResponse = z.infer<typeof meResponseSchema>;

export const patientSummarySchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string().nullable(),
  boundAt: z.string().nullable(),
});

export type PatientSummary = z.infer<typeof patientSummarySchema>;

export const patientListResponseSchema = z.object({
  patients: z.array(patientSummarySchema),
});

export type PatientListResponse = z.infer<typeof patientListResponseSchema>;

export const bindingCodeResponseSchema = z.object({
  code: z.string(),
  expiresAt: z.string(),
});

export type BindingCodeResponse = z.infer<typeof bindingCodeResponseSchema>;

/**
 * A model's proposal. `confirmedAt` stays null until a doctor confirms it;
 * an unconfirmed draft never changes what the patient sees.
 */
export type Draft<T> = {
  readonly value: T;
  readonly confirmedAt: string | null;
};
