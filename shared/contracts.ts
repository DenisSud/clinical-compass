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

/**
 * Назначение препарата (decisions.md Q32). Препарат бывает ссылкой на справочник
 * (`drugId`) и свободным текстом (`drugName`) одновременно: справочник корпуса не
 * покрывает всё, что врач выписывает, а выдумывать препарат ради ссылки нельзя.
 * `timesOfDay` — единственное расписание: «раз в день» — это его длина.
 */
export const prescriptionStatusSchema = z.enum(["draft", "active", "archived"]);

export const prescriptionSchema = z.object({
  id: z.string(),
  patientId: z.string(),
  drugId: z.string().nullable(),
  drugName: z.string(),
  doseValue: z.number(),
  doseUnit: z.string(),
  timesPerDay: z.number(),
  /** Настенные «ЧЧ:ММ» без часового пояса: расписание не сдвигается переводом часов. */
  timesOfDay: z.array(z.string()),
  startsOn: z.string(),
  /** Пусто — курс открыт: длительность определяет врач. */
  endsOn: z.string().nullable(),
  status: prescriptionStatusSchema,
  createdAt: z.string(),
  confirmedAt: z.string().nullable(),
  /** Врач, подтвердивший назначение. Без подтверждения пациент его не видит. */
  confirmedBy: z.string().nullable(),
  archivedAt: z.string().nullable(),
});

export type Prescription = z.infer<typeof prescriptionSchema>;

/**
 * Три состояния и ни одного сокращения: `no_data` — это не пропуск. Пропуск
 * отличается от «нет данных» тем, что пациент сам сказал, что приём не состоялся.
 */
export const doseStatusSchema = z.enum(["taken", "skipped", "no_data"]);

export const doseEventSchema = z.object({
  id: z.string(),
  prescriptionId: z.string(),
  /** Запланированное время приёма, «ГГГГ-ММ-ДДTЧЧ:ММ». */
  scheduledAt: z.string(),
  status: doseStatusSchema,
  /** Фактическое время приёма; null у пропуска и у «нет данных». */
  takenAt: z.string().nullable(),
  reason: z.string().nullable(),
  createdAt: z.string(),
});

export type DoseEvent = z.infer<typeof doseEventSchema>;

/** `scheduled` — время ещё не наступило; это не «нет данных» и не пропуск. */
export const doseSlotStateSchema = z.enum(["scheduled", "taken", "skipped", "no_data"]);

export type DoseSlotState = z.infer<typeof doseSlotStateSchema>;

/** Один запланированный приём в таблетнице: врачебное назначение плюс отметка пациента. */
export const doseSlotSchema = z.object({
  prescriptionId: z.string(),
  drugName: z.string(),
  doseValue: z.number(),
  doseUnit: z.string(),
  scheduledAt: z.string(),
  state: doseSlotStateSchema,
  takenAt: z.string().nullable(),
  /** Насколько позже запланированного сделан приём, в минутах. Пропуск — это разница во времени. */
  lateMinutes: z.number().nullable(),
  reason: z.string().nullable(),
  eventId: z.string().nullable(),
});

export type DoseSlot = z.infer<typeof doseSlotSchema>;

export const adherenceSummarySchema = z.object({
  /** Сколько приёмов в окне уже наступило. taken + skipped + noData = scheduled. */
  scheduled: z.number(),
  taken: z.number(),
  skipped: z.number(),
  noData: z.number(),
  /** Пропуски подряд на текущий момент — по запланированным временам, не по дням. */
  consecutiveSkips: z.number(),
});

export type AdherenceSummary = z.infer<typeof adherenceSummarySchema>;

/** Таблетница как представление назначения: расписание, отметки и сводка, не таблица. */
export const prescriptionViewSchema = z.object({
  prescription: prescriptionSchema,
  slots: z.array(doseSlotSchema),
  adherence: adherenceSummarySchema,
});

export type PrescriptionView = z.infer<typeof prescriptionViewSchema>;

const dayString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const minuteString = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);

export const prescriptionCreateSchema = z
  .object({
    /** id документа справочника (server/knowledge); проверяется против корпуса. */
    drugId: z.string().trim().min(1).nullable().optional(),
    drugName: z.string().trim().min(1).max(200),
    doseValue: z.number().positive().max(100_000),
    doseUnit: z.string().trim().min(1).max(20),
    timesPerDay: z.number().int().min(1).max(6),
    timesOfDay: z.array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)).min(1).max(6),
    startsOn: dayString,
    endsOn: dayString.nullable().optional(),
  })
  .refine((value) => value.timesOfDay.length === value.timesPerDay, {
    message: "Число времён приёма должно совпадать с числом приёмов в день",
    path: ["timesOfDay"],
  })
  .refine((value) => new Set(value.timesOfDay).size === value.timesOfDay.length, {
    message: "Два приёма не могут стоять на одно время",
    path: ["timesOfDay"],
  })
  .refine((value) => !value.endsOn || value.endsOn >= value.startsOn, {
    message: "Дата конца раньше даты начала",
    path: ["endsOn"],
  });

export type PrescriptionCreate = z.infer<typeof prescriptionCreateSchema>;

export const doseSubmitSchema = z.object({
  prescriptionId: z.string().min(1),
  /** Конкретное запланированное время, за которое отвечает отметка. */
  scheduledAt: minuteString,
  status: doseStatusSchema,
  reason: z.string().trim().max(500).optional(),
});

export type DoseSubmit = z.infer<typeof doseSubmitSchema>;

/** Таблетница на сегодня: то, что пациент может отметить прямо сейчас. */
export type DoseBoard = { today: string; doses: DoseSlot[] };

/**
 * Факты, блокирующие решение. Перечень — из ОХЛП «Авиандр» (раздел 4.3), а не из
 * воображения: каждое поле там названо противопоказанием.
 *
 * `null` значит «не спрашивали». Это не то же самое, что «нет»: правило, которое
 * читает `null` как «нет», молча выдаёт разрешение там, где данных не было.
 */
export const triStateSchema = z.enum(["yes", "no"]);
export const maoInhibitorsSchema = z.enum(["none", "current", "stopped_under_2_weeks"]);
export const childPughSchema = z.enum(["A", "B", "C"]);
export const pregnancySchema = z.enum(["not_applicable", "no", "pregnant", "lactating"]);

export const patientFactsSchema = z.object({
  /** Эпилепсия и органические заболевания мозга. ОХЛП 4.3. */
  epilepsyOrOrganicBrainDisease: triStateSchema.nullable(),
  /** Ингибиторы МАО: приём сейчас или отмена меньше двух недель назад. ОХЛП 4.3. */
  maoInhibitors: maoInhibitorsSchema.nullable(),
  /** СКФ, мл/мин. Порог 60 задаёт правило со ссылкой, а не поле. ОХЛП 4.3. */
  egfrMlMin: z.number().int().min(0).max(200).nullable(),
  /** Печёночная недостаточность по Чайлд-Пью: любая степень — противопоказание. ОХЛП 4.3. */
  childPugh: childPughSchema.nullable(),
  /** Беременность и лактация. ОХЛП 4.3. */
  pregnancy: pregnancySchema.nullable(),
  /** Непереносимость галактозы. ОХЛП 4.3. */
  galactoseIntolerance: triStateSchema.nullable(),
});

export type PatientFacts = z.infer<typeof patientFactsSchema>;

/** Пациент может ответить на часть вопросов: непереданное поле не затирается. */
export const patientFactsUpdateSchema = patientFactsSchema.partial();
export type PatientFactsUpdate = z.infer<typeof patientFactsUpdateSchema>;

/**
 * `unanswered` — это не интерпретация и не оценка риска, а список того, чего мы
 * ещё не спросили. Пациент имеет право видеть свою неполноту; выводов из неё
 * не делает ни он, ни интерфейс.
 */
export type PatientFactsView = {
  facts: PatientFacts;
  unanswered: (keyof PatientFacts)[];
};

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
