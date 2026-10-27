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

/**
 * Специальность врача — поле врача, а не вторая роль (SPEC S2). Она задаёт этап его
 * пациентов: терапевт — скрининг, психиатр — терапия (S3, Q49).
 */
export const doctorSpecialtySchema = z.enum(["therapist", "psychiatrist"]);

export type DoctorSpecialty = z.infer<typeof doctorSpecialtySchema>;

/**
 * Тело регистрации врача. Специальность обязательна: от неё зависит этап его пациентов
 * (S3), и молча выбранный терапевт это клиническое решение, принятое за врача.
 */
export const doctorSignupSchema = credentialsSchema.extend({
  specialty: doctorSpecialtySchema,
});

export type DoctorSignup = z.infer<typeof doctorSignupSchema>;

export const doctorProfileSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string().nullable(),
  specialty: doctorSpecialtySchema,
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
  /**
   * Напоминать о приёме на почту — предпочтение пациента (SPEC S24, Q49).
   * Согласие, а не факт отправки: отправки писем в продукте нет.
   */
  remindByEmail: z.boolean(),
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
  /**
   * Этап пациента. Следует из специальности ведущего врача (SPEC S3, Q49) и выбирает
   * набор опросников (content/instrument-statuses.json); пациенту не показывается.
   */
  status: z.string(),
  statusLabel: z.string(),
});

export type PatientSummary = z.infer<typeof patientSummarySchema>;

/** Что врач может поставить. Значения — из файла статусов, но список закрыт и проверяется здесь. */
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
 * Предложение модели. `confirmedAt` остаётся null, пока врач его не подтвердит;
 * неподтверждённый черновик никогда не меняет то, что видит пациент.
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

/**
 * Отправка шкалы врачом (SPEC S14, Q53): маршрут пациента её не принимает, а маршрут
 * врача требует, чтобы шкала была объявлена врачебной в своём файле (audience "doctor").
 */
export const doctorAssessmentSubmitSchema = assessmentSubmitSchema.extend({
  instrumentId: z.string().min(1),
});

export type DoctorAssessmentSubmit = z.infer<typeof doctorAssessmentSubmitSchema>;

export const assessmentAnswerSchema = z.object({
  itemId: z.string(),
  text: z.string(),
  value: z.number(),
  label: z.string(),
});

/** Собственный взгляд пациента: только ответы, без суммы и без полосы. */
export const patientAssessmentSchema = z.object({
  id: z.string(),
  instrumentId: z.string(),
  instrumentTitle: z.string(),
  submittedAt: z.string(),
  answers: z.array(assessmentAnswerSchema),
});

export type PatientAssessment = z.infer<typeof patientAssessmentSchema>;

/** Взгляд врача: те же ответы, посчитанные. */
export const doctorAssessmentSchema = z.object({
  id: z.string(),
  instrumentId: z.string(),
  instrumentTitle: z.string(),
  submittedAt: z.string(),
  /**
   * Общая сумма; null у шкалы без суммы (UKU). Числа там нет, а не ноль:
   * врач читает «—», а не пустую строку, которую можно принять за ответ.
   */
  total: z.number().nullable(),
  band: z.object({ id: z.string(), label: z.string() }),
  criticalItems: z.array(z.string()),
  /** True, когда сохранённое описание инструмента больше недоступно. */
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

/** Опросник в том виде, в каком его получает пациент: без полос, без признаков критического пункта. */
/** Вариант ответа: у HADS и UKU он свой у каждого пункта, у PHQ-9 общий на шкалу. */
const answerOptionViewSchema = z.object({ value: z.number(), label: z.string() });

export const instrumentViewSchema = z.object({
  id: z.string(),
  title: z.string(),
  intro: z.string(),
  options: z.array(answerOptionViewSchema),
  items: z.array(
    z.object({
      id: z.string(),
      text: z.string(),
      options: z.array(answerOptionViewSchema).optional(),
    }),
  ),
  sourceNote: z.string(),
});

export type InstrumentView = z.infer<typeof instrumentViewSchema>;

/** Порядок — из файла статуса: пациент видит назначенное, а не весь реестр. */
/** В списке у шкалы есть дата, когда её можно пройти: у формы её нет, там нечего ждать. */
export const patientInstrumentViewSchema = instrumentViewSchema.extend({
  nextAttemptAt: z.string().nullable(),
});

export type PatientInstrumentView = z.infer<typeof patientInstrumentViewSchema>;

export const instrumentListResponseSchema = z.object({
  instruments: z.array(patientInstrumentViewSchema),
});

export type InstrumentListResponse = z.infer<typeof instrumentListResponseSchema>;

/**
 * Откуда взялось правило. `status` это маркер честности: заглушка говорит, что
 * источник наш, пока не пришли клинические материалы (decisions.md Q31).
 */
export const signalRuleSourceSchema = z.object({
  kind: z.enum(["guideline", "ohlp", "ours"]),
  ref: z.string(),
  status: z.enum(["placeholder", "confirmed"]),
});

export type SignalRuleSource = z.infer<typeof signalRuleSourceSchema>;

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
  /** Заполняется, когда сигнал пришёл из правила, написанного врачом, а не из встроенного набора. */
  watchItemId: z.string().nullable(),
  /**
   * Правило реестра за карточкой. Null для сигнала по полосе шкалы и для правил
   * врача, где нет файла правила, на который можно указать.
   */
  ruleId: z.string().nullable(),
  ruleTitle: z.string().nullable(),
  ruleSource: signalRuleSourceSchema.nullable(),
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
 * Рекомендация, с которой врач может работать. `basis` это почему она вообще на экране,
 * `missing` это чего мы не знаем и что нужно до решения. Карточка с пустым основанием
 * это дефект: кейс требует, чтобы каждая рекомендация объясняла себя.
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
  // Та же форма, что у дневника: всё дальше по цепочке смотрит на эту самую строку.
  checkinDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

/** Одно назначение в том виде, в каком его сегодня видит пациент. */
export type PatientCheckinItem = {
  planItemId: string;
  title: string;
  kind: PlanItem["kind"];
  status: "done" | "skipped" | null;
  reason: string | null;
};

export type PatientCheckins = { today: string; items: PatientCheckinItem[] };

/**
 * Три состояния, никогда два. День без ответа это не пропущенный приём, и врач,
 * который их не различает, прочитает молчание как неприверженность.
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

/**
 * Приём, назначенный психиатром (SPEC S24, Q49). `cancelledAt` — отмена, а не
 * отсутствие строки: история приёмов остаётся, и «перенесли» отличимо от «не было».
 */
export const appointmentSchema = z.object({
  id: z.string(),
  patientId: z.string(),
  /** ISO-время с зоной: сутки до приёма считаются от текущего момента. */
  scheduledAt: z.string(),
  createdAt: z.string(),
  cancelledAt: z.string().nullable(),
});

export type Appointment = z.infer<typeof appointmentSchema>;

/** Время приёма вводит врач: ISO-строка с зоной, а не «завтра после обеда». */
export const appointmentCreateSchema = z.object({
  scheduledAt: z.iso.datetime(),
});

/** Напоминание на почту: согласие пациента, а не запись об отправке письма (S24). */
export const appointmentReminderSchema = z.object({ remindByEmail: z.boolean() });

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
/**
 * «none» — пациент ответил, что недостаточности нет. Это ответ, а не пустота: правила
 * перечисляют A, B и C, поэтому «none» ни одно из них не включает (#48).
 */
export const childPughSchema = z.enum(["A", "B", "C", "none"]);
export const pregnancySchema = z.enum(["not_applicable", "no", "pregnant", "lactating"]);

export const patientFactsSchema = z.object({
  /** Эпилепсия и органические заболевания мозга. ОХЛП 4.3. */
  epilepsyOrOrganicBrainDisease: triStateSchema.nullable(),
  /** Ингибиторы МАО: приём сейчас или отмена меньше двух недель назад. ОХЛП 4.3. */
  maoInhibitors: maoInhibitorsSchema.nullable(),
  /**
   * СКФ, мл/мин. Один знак после запятой — потому что значение приходит из анализа
   * (59.6), а не из головы: целое поле заставляло округлять 59.6 до 60, и порог правила
   * «ниже 60» переставал срабатывать (#52). Сам порог задаёт правило со ссылкой, а не
   * поле. ОХЛП 4.3.
   */
  egfrMlMin: z.number().min(0).max(200).multipleOf(0.1).nullable(),
  /** Печёночная недостаточность по Чайлд-Пью: любая степень — противопоказание. ОХЛП 4.3. */
  childPugh: childPughSchema.nullable(),
  /** Беременность и лактация. ОХЛП 4.3. */
  pregnancy: pregnancySchema.nullable(),
  /** Непереносимость галактозы. ОХЛП 4.3. */
  galactoseIntolerance: triStateSchema.nullable(),
});

export type PatientFacts = z.infer<typeof patientFactsSchema>;

/**
 * Тело `PUT /api/facts`. Partial: непереданное поле не затирается. Strict: опечатка
 * в имени поля — отказ с этим именем, а не 200 с тихой потерей записи (#53).
 *
 * Строгость — только у тела запроса. Строку из БД этой схемой не читают: иначе
 * колонка, добавленная позже, ломала бы чтение уже данных ответов.
 */
export const patientFactsUpdateSchema = patientFactsSchema.partial().strict();
export type PatientFactsUpdate = z.infer<typeof patientFactsUpdateSchema>;

/**
 * `unanswered` — это не интерпретация и не оценка риска, а список того, чего мы
 * ещё не спросили. Пациент имеет право видеть свою неполноту; выводов из неё
 * не делает ни он, ни интерфейс.
 */
export type PatientFactsView = {
  facts: PatientFacts;
  unanswered: (keyof PatientFacts)[];
  /**
   * Когда пациент последний раз отвечал. Строка одна на пациента, поэтому это дата
   * последнего ответа, а не каждого вопроса: подписать ею каждый ответ значило бы
   * соврать про более ранние.
   */
  answeredAt: string | null;
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

/** Что врач держит под наблюдением, вместе с параметрами, которые делают это проверяемым. */
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

/** Что можно выбрать в правиле «сумма выше порога»: шкалы из набора пациента. */
export const instrumentChoiceSchema = z.object({
  id: z.string(),
  title: z.string(),
  /** Сумма есть или её нет: у шкалы без суммы правило порога не сработает никогда. */
  scoring: z.enum(["sum", "items"]),
});

export type InstrumentChoice = z.infer<typeof instrumentChoiceSchema>;

export const instrumentChoicesResponseSchema = z.object({
  instruments: z.array(instrumentChoiceSchema),
});

/**
 * Описание правила человеческим языком, чтобы врачу не приходилось читать JSON.
 * `titles` это названия шкал: без них «сумма опросника 14 и выше» не говорит, какой
 * именно шкалы, а у пациента их несколько.
 */
export function describeWatch(
  item: Pick<WatchItem, "kind" | "params">,
  titles: Record<string, string> = {},
): string {
  switch (item.kind) {
    case "diary_below":
      return `самочувствие ${String(item.params.threshold)} или ниже`;
    case "diary_drop":
      return `падение самочувствия на ${String(item.params.points)} и больше`;
    case "score_threshold": {
      const title = titles[String(item.params.instrumentId)];
      return title
        ? `сумма «${title}» ${String(item.params.threshold)} и выше`
        : `сумма опросника ${String(item.params.threshold)} и выше`;
    }
    case "missed_doses":
      return `${String(item.params.days)} пропуска приёма подряд`;
    case "message_keyword":
      return `слова в сообщении: ${(item.params.terms as string[]).join(", ")}`;
  }
}
