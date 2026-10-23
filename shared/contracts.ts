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

export const assessmentSubmitSchema = z.object({
  submissionId: z.string().min(1).max(100),
  answers: z.record(z.string(), z.number().int()),
});

export type AssessmentSubmit = z.infer<typeof assessmentSubmitSchema>;

export const assessmentAnswerSchema = z.object({
  itemId: z.string(),
  text: z.string(),
  value: z.number(),
  label: z.string(),
});

/** The patient's own view: answers only, no score and no band. */
export const patientAssessmentSchema = z.object({
  id: z.string(),
  instrumentId: z.string(),
  instrumentTitle: z.string(),
  submittedAt: z.string(),
  answers: z.array(assessmentAnswerSchema),
});

export type PatientAssessment = z.infer<typeof patientAssessmentSchema>;

/** The doctor's view: the same answers, scored. */
export const doctorAssessmentSchema = z.object({
  id: z.string(),
  instrumentId: z.string(),
  instrumentTitle: z.string(),
  submittedAt: z.string(),
  total: z.number(),
  band: z.object({ id: z.string(), label: z.string() }),
  criticalItems: z.array(z.string()),
  /** True when the stored instrument description is no longer available. */
  instrumentMissing: z.boolean().optional(),
});

export type DoctorAssessment = z.infer<typeof doctorAssessmentSchema>;

export const diarySubmitSchema = z.object({
  submissionId: z.string().min(1).max(100),
  value: z.number().int().min(1).max(10),
  comment: z.string().trim().max(2000).optional(),
  entryDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export const diaryEntrySchema = z.object({
  id: z.string(),
  entryDate: z.string(),
  value: z.number(),
  comment: z.string().nullable(),
  createdAt: z.string(),
});

export type DiaryEntry = z.infer<typeof diaryEntrySchema>;

/** The questionnaire as the patient receives it: no bands, no critical flags. */
export const instrumentViewSchema = z.object({
  id: z.string(),
  title: z.string(),
  intro: z.string(),
  options: z.array(z.object({ value: z.number(), label: z.string() })),
  items: z.array(z.object({ id: z.string(), text: z.string() })),
  sourceNote: z.string(),
});

export type InstrumentView = z.infer<typeof instrumentViewSchema>;

export const signalSchema = z.object({
  id: z.string(),
  patientId: z.string(),
  kind: z.string(),
  severity: z.enum(["critical", "high", "medium"]),
  title: z.string(),
  detail: z.string(),
  status: z.enum(["saved", "in_review", "closed"]),
  outcome: z.string().nullable(),
  createdAt: z.string(),
  takenAt: z.string().nullable(),
  closedAt: z.string().nullable(),
  /** Set when the signal came from a rule the doctor wrote, not from the built-in set. */
  watchItemId: z.string().nullable(),
});

export type Signal = z.infer<typeof signalSchema>;

export const doctorSignalSchema = signalSchema.extend({
  patient: z.object({ id: z.string(), email: z.string(), name: z.string().nullable() }).nullable(),
});

export type DoctorSignal = z.infer<typeof doctorSignalSchema>;

export const signalCloseSchema = z.object({
  outcome: z.string().trim().min(3).max(2000),
});

export const planItemKindSchema = z.enum(["medication", "therapy", "observation", "referral"]);

export const planItemCreateSchema = z.object({
  kind: planItemKindSchema,
  title: z.string().trim().min(1).max(200),
  details: z.string().trim().max(2000).optional(),
});

export const planItemSchema = z.object({
  id: z.string(),
  patientId: z.string(),
  kind: planItemKindSchema,
  title: z.string(),
  details: z.string().nullable(),
  status: z.enum(["draft", "active", "archived"]),
  createdAt: z.string(),
  confirmedAt: z.string().nullable(),
  archivedAt: z.string().nullable(),
});

export type PlanItem = z.infer<typeof planItemSchema>;

export const messageCreateSchema = z.object({
  body: z.string().trim().min(1).max(4000),
});

export const messageSchema = z.object({
  id: z.string(),
  patientId: z.string(),
  authorRole: z.enum(["doctor", "patient"]),
  body: z.string(),
  createdAt: z.string(),
});

export type Message = z.infer<typeof messageSchema>;

/**
 * A recommendation the doctor may act on. `basis` is why it is on screen at all,
 * `missing` is what we do not know and would need before deciding. A card with an
 * empty basis is a defect: the case requires every recommendation to explain itself.
 */
export const therapyCardSchema = z.object({
  id: z.string(),
  title: z.string(),
  basis: z.string(),
  missing: z.array(z.string()),
  source: z
    .object({ kind: z.enum(["smpc", "guideline"]), ref: z.string(), url: z.string() })
    .nullable(),
});

export type TherapyCard = z.infer<typeof therapyCardSchema>;

export const checkinStatusSchema = z.enum(["done", "skipped"]);

export const checkinSubmitSchema = z.object({
  planItemId: z.string().min(1),
  status: checkinStatusSchema,
  reason: z.string().trim().max(500).optional(),
  // Same shape as the diary: everything downstream keys on this exact string.
  checkinDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

/** One prescription as the patient sees it today. */
export type PatientCheckinItem = {
  planItemId: string;
  title: string;
  kind: PlanItem["kind"];
  status: "done" | "skipped" | null;
  reason: string | null;
};

export type PatientCheckins = { today: string; items: PatientCheckinItem[] };

/**
 * Three states, never two. A day with no answer is not a missed dose, and a doctor
 * who cannot tell them apart will read silence as non-adherence.
 */
export type AdherenceDay = {
  date: string;
  state: "done" | "skipped" | "no_data";
  reason: string | null;
};

export type AdherenceItem = {
  planItemId: string;
  title: string;
  kind: PlanItem["kind"];
  status: "active" | "archived";
  startedAt: string;
  days: AdherenceDay[];
  done: number;
  skipped: number;
  noData: number;
};

export type DoctorAdherence = { today: string; items: AdherenceItem[] };

export const watchKindSchema = z.enum([
  "diary_below",
  "diary_drop",
  "score_threshold",
  "missed_doses",
  "message_keyword",
]);

export type WatchKind = z.infer<typeof watchKindSchema>;

export const watchSeveritySchema = z.enum(["medium", "high", "critical"]);

const watchBase = {
  title: z.string().trim().min(3, "Название — не короче 3 символов").max(120),
  severity: watchSeveritySchema,
};

/** What the doctor is watching, with the parameters that make it checkable. */
export const watchCreateSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("diary_below"), threshold: z.number().int().min(1).max(10), ...watchBase }),
  z.object({ kind: z.literal("diary_drop"), points: z.number().int().min(1).max(9), ...watchBase }),
  z.object({
    kind: z.literal("score_threshold"),
    instrumentId: z.string().min(1),
    threshold: z.number().int().min(0).max(100),
    ...watchBase,
  }),
  z.object({ kind: z.literal("missed_doses"), days: z.number().int().min(1).max(14), ...watchBase }),
  z.object({
    kind: z.literal("message_keyword"),
    terms: z.array(z.string().trim().min(2)).min(1).max(10),
    ...watchBase,
  }),
]);

export type WatchCreate = z.infer<typeof watchCreateSchema>;

export type WatchItem = {
  id: string;
  patientId: string;
  kind: WatchKind;
  title: string;
  severity: "medium" | "high" | "critical";
  params: Record<string, unknown>;
  status: "active" | "paused";
  createdAt: string;
  pausedAt: string | null;
};

/** Plain-language description of a rule, so the doctor does not have to read JSON. */
export function describeWatch(item: Pick<WatchItem, "kind" | "params">): string {
  switch (item.kind) {
    case "diary_below":
      return `самочувствие ${String(item.params.threshold)} или ниже`;
    case "diary_drop":
      return `падение самочувствия на ${String(item.params.points)} и больше`;
    case "score_threshold":
      return `сумма опросника ${String(item.params.threshold)} и выше`;
    case "missed_doses":
      return `${String(item.params.days)} пропуска приёма подряд`;
    case "message_keyword":
      return `слова в сообщении: ${(item.params.terms as string[]).join(", ")}`;
  }
}
