import { z } from "zod";
import type { PatientFacts } from "./contracts.js";

/**
 * A rule is a condition on the fields we already collect, the output the doctor
 * reads, and the source it comes from. `source` is required by the schema: a rule
 * without one is not a rule with a missing link, it is not a rule at all.
 *
 * The rule files live in `content/rules/`, one JSON per rule. The same files are
 * meant to be read by a human, by the application and by the model, so every
 * wording shown to the doctor sits in the file rather than in code.
 */

export const ruleSeveritySchema = z.enum(["critical", "high", "medium"]);
export type RuleSeverity = z.infer<typeof ruleSeveritySchema>;

/**
 * `kind` says who the source belongs to, `status` says whether the source can be
 * trusted as written. A placeholder names the gap instead of hiding it: the
 * threshold is ours until the clinical materials arrive (decisions.md Q31).
 */
export const ruleSourceSchema = z.strictObject({
  kind: z.enum(["guideline", "ohlp", "ours"]),
  /** Path to the document plus a section, e.g. `docs/…/ohlp-aviandr.md#4.3`. */
  ref: z.string().min(1),
  quote: z.string().min(1).optional(),
  status: z.enum(["placeholder", "confirmed"]),
});
export type RuleSource = z.infer<typeof ruleSourceSchema>;

/**
 * One check against the facts we hold. A rule lists several checks joined by "or",
 * so a set of contraindications stays one rule. More than one check may match at
 * once: the semantics stay "or", but the card then names every match, not the first
 * (issue #38).
 *
 * `patientFact.*` checks carry their own `label`: the doctor must read which fact
 * matched, and the rule file must say it in words the doctor sees.
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
   * Checks are joined by "or". Several of them may match at once, and the template
   * receives all matched values: «СКФ 45 и беременность» is one rule with two matches,
   * and naming only the first hides the other from the doctor (issue #38).
   */
  when: z.array(ruleConditionSchema).min(1),
  severity: ruleSeveritySchema,
  output: z.strictObject({
    title: z.string().min(1),
    /** Template: `{name}` is filled from the checks that matched, joined by `; `. */
    detail: z.string().min(1),
  }),
  source: ruleSourceSchema,
});
export type Rule = z.infer<typeof ruleSchema>;

export const rulesResponseSchema = z.object({ rules: z.array(ruleSchema) });
export type RulesResponse = z.infer<typeof rulesResponseSchema>;

/**
 * Прошлая отправка, с которой сравнивается текущая. Она называет шкалу и версию,
 * потому что «стало хуже» — утверждение об инструменте, а не о пациенте: сумма ASQ
 * и сумма PHQ-9 отвечают на разные вопросы, а смена версии шкалы меняет смысл
 * суммы. Сравнение вне пары «та же шкала и та же версия» не выражается (decisions.md §4, Q28).
 */
export type PreviousAssessment = {
  instrumentId: string;
  instrumentVersion: string;
  total: number;
};

/**
 * What the registry knows about one patient at a moment. No database and no
 * clock: the same facts always produce the same matches.
 */
export type RuleFacts = {
  assessment: {
    instrumentId: string;
    instrumentVersion: string;
    /**
     * The title the doctor reads. A signal that says «отмечен критический пункт»
     * without naming the questionnaire makes the doctor guess which form was filled
     * in, so the rule file has to be able to say it.
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
