import type { DecisionQuestion } from "../../shared/decisions.js";
import type { PatientFacts } from "../../shared/contracts.js";
import type { RuleCondition, RuleFacts, RuleSeverity, RuleSource } from "../../shared/rules.js";
import { allConditionsMatch, renderTemplate } from "../rules/registry.js";

export type DecisionVerdict = "yes" | "no" | "insufficient";

/**
 * One answer about the patient. `insufficient` is a full answer, not an error: the
 * system says which data it lacks instead of letting a missing fact read as «no»
 * (decisions.md Q36, Q44). Only `yes` becomes a signal; refusing is silent on the card.
 */
export type DecisionAnswer = {
  questionId: string;
  question: string;
  verdict: DecisionVerdict;
  /** What is missing, in words a doctor reads. Empty for yes and no. */
  missing: string[];
  /** The answer's wording, present only for `yes`: the signal takes it from here. */
  title?: string;
  detail?: string;
  severity?: RuleSeverity;
  source: RuleSource;
};

/**
 * Answers every question against one patient's facts. Pure: no database, no clock,
 * no model, so the same facts always produce the same answers.
 *
 * Conditions are joined by "and": a single false condition makes the answer `no`.
 * Checked before anything else, because a condition's fact being absent is not the
 * same as the condition not holding.
 */
export function answerQuestions(
  questions: readonly DecisionQuestion[],
  facts: RuleFacts,
): DecisionAnswer[] {
  return questions.map((question) => {
    const missing = [...new Set(question.when.map((condition) => missingLabel(condition, facts)))].filter(
      (label): label is string => label !== null,
    );

    if (missing.length > 0) {
      return {
        questionId: question.id,
        question: question.question,
        verdict: "insufficient",
        missing,
        source: question.source,
      };
    }

    const values = allConditionsMatch(question.when, facts);
    if (values === null) {
      return {
        questionId: question.id,
        question: question.question,
        verdict: "no",
        missing: [],
        source: question.source,
      };
    }

    return {
      questionId: question.id,
      question: question.question,
      verdict: "yes",
      missing: [],
      title: renderTemplate(question.output.title, values),
      detail: renderTemplate(question.output.detail, values),
      severity: question.severity,
      source: question.source,
    };
  });
}

/**
 * What a condition needs and the facts do not have. Returning null means "the data is
 * here", not "the condition holds": whether it holds is `allConditionsMatch`'s job.
 *
 * `assessment.totalIncrease` needs two submissions of the *same* instrument and
 * version: a previous score of another scale cannot be compared, and calling that
 * "no" would answer a question nobody asked (Q28).
 */
function missingLabel(condition: RuleCondition, facts: RuleFacts): string | null {
  switch (condition.fact) {
    case "assessment.criticalItem":
      return facts.assessment === null ? "нет отправленной шкалы" : null;

    case "assessment.totalIncrease": {
      const assessment = facts.assessment;
      if (assessment === null) return "нет отправленной шкалы";
      const previous = assessment.previous;
      if (previous === null) return "нет прошлой отправки этой шкалы";
      if (previous.instrumentId !== assessment.instrumentId) {
        return "прошлая отправка была другой шкалой";
      }
      if (previous.instrumentVersion !== assessment.instrumentVersion) {
        return "прошлая отправка была другой версии шкалы";
      }
      return null;
    }

    case "diary.value":
      return facts.diary === null ? "нет записи дневника" : null;

    case "diary.drop":
      return facts.diary === null || facts.diary.previousValue === null
        ? "нет предыдущей записи дневника"
        : null;

    case "adherence.consecutiveMissedDoses":
      return facts.adherence === null ? "нет отметок приёма препаратов" : null;

    default: {
      // «Не спрашивали» — это NULL в строке фактов, и оно не равно «нет»: условие на
      // неизвестном факте не выполняется, но и ответ «нет» был бы выдумкой (Q36).
      const field = condition.fact.slice("patientFact.".length) as keyof PatientFacts;
      const row = facts.patientFacts;
      return row === null || row[field] === null ? "не заполнены факты пациента" : null;
    }
  }
}
