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
 * One check against the facts we hold. A rule lists several checks and fires on
 * the first that matches, so a set of contraindications stays one rule.
 *
 * `patientFact.*` checks carry their own `label`: the doctor must read which fact
 * fired, and the rule file must say it in words the doctor sees.
 */
export const ruleConditionSchema = z.discriminatedUnion("fact", [
  z.strictObject({
    fact: z.literal("assessment.criticalItem"),
    instrumentId: z.string().min(1).optional(),
  }),
  z.strictObject({
    fact: z.literal("assessment.totalIncrease"),
    instrumentId: z.string().min(1),
    atLeast: z.number().int().positive(),
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
  /** Checks are joined by "or": the first one that matches fires the rule. */
  when: z.array(ruleConditionSchema).min(1),
  severity: ruleSeveritySchema,
  output: z.strictObject({
    title: z.string().min(1),
    /** Template: `{name}` is filled from the fact that fired. */
    detail: z.string().min(1),
  }),
  source: ruleSourceSchema,
});
export type Rule = z.infer<typeof ruleSchema>;

export const rulesResponseSchema = z.object({ rules: z.array(ruleSchema) });
export type RulesResponse = z.infer<typeof rulesResponseSchema>;

/**
 * What the registry knows about one patient at a moment. No database and no
 * clock: the same facts always produce the same matches.
 */
export type RuleFacts = {
  assessment: {
    instrumentId: string;
    total: number;
    previousTotal: number | null;
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
