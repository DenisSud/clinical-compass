import { z } from "zod";
import type { PatientFacts } from "./contracts.js";

/**
 * Правило это условие на поля, которые мы уже собираем, вывод, который читает врач,
 * и источник, откуда оно. `source` обязателен по схеме: правило без него это не правило
 * с недостающей ссылкой, а не правило вообще.
 *
 * Файлы правил лежат в `content/rules/`, один JSON на правило. Эти же файлы
 * должны читать человек, приложение и модель, поэтому каждая формулировка, которую
 * видит врач, лежит в файле, а не в коде.
 */

export const ruleSeveritySchema = z.enum(["critical", "high", "medium"]);
export type RuleSeverity = z.infer<typeof ruleSeveritySchema>;

/**
 * `kind` говорит, кому принадлежит источник, `status` говорит, можно ли доверять
 * источнику как написанному. Заглушка называет пробел, а не прячет его: порог наш,
 * пока не пришли клинические материалы (decisions.md Q31).
 */
export const ruleSourceSchema = z.strictObject({
  kind: z.enum(["guideline", "ohlp", "ours"]),
  /** Путь к документу вместе с разделом, например `docs/…/ohlp-aviandr.md#4.3`. */
  ref: z.string().min(1),
  quote: z.string().min(1).optional(),
  status: z.enum(["placeholder", "confirmed"]),
});
export type RuleSource = z.infer<typeof ruleSourceSchema>;

/**
 * Одна проверка против фактов, которые у нас есть. Правило перечисляет несколько проверок,
 * соединённых через «или», поэтому набор противопоказаний остаётся одним правилом. Совпасть
 * может больше одной проверки: смысл остаётся «или», но карточка называет каждое совпадение,
 * а не первое (issue #38).
 *
 * Проверки `patientFact.*` несут собственную `label`: врач должен прочитать, какой факт
 * совпал, и файл правила обязан сказать это словами, которые врач видит.
 */
export const ruleConditionSchema = z.discriminatedUnion("fact", [
  z.strictObject({
    fact: z.literal("assessment.criticalItem"),
    instrumentId: z.string().min(1).optional(),
  }),
  z.strictObject({
    fact: z.literal("assessment.totalIncrease"),
    instrumentId: z.string().min(1).optional(),
    atLeast: z.number().int().positive(),
  }),
  z.strictObject({
    fact: z.literal("diary.value"),
    atMost: z.number().int().positive(),
  }),
  z.strictObject({
    fact: z.literal("diary.drop"),
    atLeast: z.number().int().positive(),
  }),
  z.strictObject({
    fact: z.literal("adherence.consecutiveMissedDoses"),
    atLeast: z.number().int().positive(),
  }),
  z.strictObject({
    fact: z.literal("patientFact.epilepsyOrOrganicBrainDisease"),
    is: z.literal("yes"),
    label: z.string().min(1),
  }),
  z.strictObject({
    fact: z.literal("patientFact.maoInhibitors"),
    is: z.enum(["current", "stopped_under_2_weeks"]),
    label: z.string().min(1),
  }),
  z.strictObject({
    fact: z.literal("patientFact.egfrMlMin"),
    below: z.number().positive(),
    label: z.string().min(1),
  }),
  z.strictObject({
    fact: z.literal("patientFact.childPugh"),
    is: z.enum(["A", "B", "C"]),
    label: z.string().min(1),
  }),
  z.strictObject({
    fact: z.literal("patientFact.pregnancy"),
    is: z.enum(["pregnant", "lactating"]),
    label: z.string().min(1),
  }),
  z.strictObject({
    fact: z.literal("patientFact.galactoseIntolerance"),
    is: z.literal("yes"),
    label: z.string().min(1),
  }),
]);
export type RuleCondition = z.infer<typeof ruleConditionSchema>;

export const ruleSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  title: z.string().min(1),
  /**
   * Проверки соединены через «или». Несколько из них могут совпасть сразу, и шаблон
   * получает все совпавшие значения: «СКФ 45 и беременность» это одно правило с двумя
   * совпадениями, и называть только первое значит спрятать от врача второе (issue #38).
   */
  when: z.array(ruleConditionSchema).min(1),
  severity: ruleSeveritySchema,
  output: z.strictObject({
    title: z.string().min(1),
    /** Шаблон: `{name}` заполняется совпавшими проверками, соединёнными через `; `. */
    detail: z.string().min(1),
  }),
  source: ruleSourceSchema,
});
export type Rule = z.infer<typeof ruleSchema>;

export const rulesResponseSchema = z.object({ rules: z.array(ruleSchema) });
export type RulesResponse = z.infer<typeof rulesResponseSchema>;

/**
 * Прошлая отправка, с которой сравнивается текущая. Она называет шкалу и версию,
 * потому что «стало хуже» — утверждение об инструменте, а не о пациенте: сумма HADS-Т
 * и сумма HADS-Д отвечают на разные вопросы, а смена версии шкалы меняет смысл
 * суммы. Сравнение вне пары «та же шкала и та же версия» не выражается (decisions.md §4, Q28).
 */
export type PreviousAssessment = {
  instrumentId: string;
  instrumentVersion: string;
  total: number;
};

/**
 * Что реестр знает об одном пациенте в один момент. Ни базы, ни часов:
 * одни и те же факты всегда дают одни и те же совпадения.
 */
export type RuleFacts = {
  assessment: {
    instrumentId: string;
    instrumentVersion: string;
    /**
     * Название, которое читает врач. Сигнал «отмечен критический пункт» без названия опросника
     * заставляет врача гадать, какая форма заполнена, поэтому файл правила должен уметь его сказать.
     */
    instrumentTitle: string;
    total: number;
    /** Прошлая отправка этой же шкалы или null — тогда сравнивать не с чем. */
    previous: PreviousAssessment | null;
    criticalItems: string[];
  } | null;
  diary: { value: number; previousValue: number | null } | null;
  adherence: { consecutiveMissedDoses: number } | null;
  patientFacts: PatientFacts | null;
};

export type RuleMatch = {
  ruleId: string;
  title: string;
  severity: RuleSeverity;
  detail: string;
  source: RuleSource;
};
