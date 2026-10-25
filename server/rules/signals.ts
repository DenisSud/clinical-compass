import type { RuleFacts, RuleSeverity } from "../../shared/rules.js";
import { criticalItems } from "../instruments/engine.js";
import type { Instrument } from "../instruments/schema.js";
import { evaluateRule, requireRule } from "./registry.js";

export type Severity = RuleSeverity;

export type SignalDraft = {
  kind: string;
  severity: Severity;
  title: string;
  detail: string;
  /**
   * The registry rule that raised the signal. Null for the instrument-band signal
   * and for the doctor's own rules: neither has a rule file behind it.
   */
  ruleId: string | null;
};

/**
 * Rules the signal engine reads, with the kind stored on the signal. The kind is what
 * the unique index dedupes on and what the cards already in the database carry; the
 * doctor reads the rule id and its source on the card.
 *
 * This list is the code side of the parity test (rules/parity.test.ts): a rule file
 * without an entry here can never fire, and an entry with no file behind it stops the
 * build instead of quietly dropping a signal. Thresholds, severity and wording live
 * in content/rules/*.json, not here (decisions.md Q31).
 */
const SIGNAL_RULES = [
  { kind: "critical_item", ruleId: "critical-item" },
  { kind: "worsening", ruleId: "worsening" },
  { kind: "low_wellbeing", ruleId: "diary-low-wellbeing" },
  { kind: "sharp_drop", ruleId: "diary-sharp-drop" },
] as const;

export const SIGNAL_RULE_IDS: readonly string[] = SIGNAL_RULES.map(({ ruleId }) => ruleId);

/**
 * Facts in, signals out. This module supplies only what the registry cannot know how
 * to read; every threshold and every word shown to the doctor comes from the rule file.
 */
function signalsFromRules(facts: RuleFacts): SignalDraft[] {
  return SIGNAL_RULES.flatMap(({ kind, ruleId }) => {
    const match = evaluateRule(requireRule(ruleId), facts);
    if (match === null) return [];

    return [
      {
        kind,
        severity: match.severity,
        title: match.title,
        detail: match.detail,
        ruleId: match.ruleId,
      },
    ];
  });
}

const NO_FACTS: Omit<RuleFacts, "assessment" | "diary"> = {
  adherence: null,
  patientFacts: null,
};

/**
 * Rules read one submission plus what came before it and return the signals it
 * deserves. They never decide anything for the doctor: a signal is a question to
 * look at, not an instruction.
 */
export function signalsForAssessment(input: {
  instrument: Instrument;
  answers: Record<string, number>;
  total: number;
  previousTotal: number | null;
}): SignalDraft[] {
  const signals = signalsFromRules({
    ...NO_FACTS,
    assessment: {
      instrumentId: input.instrument.id,
      instrumentTitle: input.instrument.title,
      total: input.total,
      previousTotal: input.previousTotal,
      criticalItems: criticalItems(input.instrument, input.answers),
    },
    diary: null,
  });

  const bandSignal = bandSignalForAssessment(input);
  return bandSignal === null ? signals : [...signals, bandSignal];
}

/**
 * The total-score signal belongs to the instrument, not to a rule file: the threshold
 * is the instrument's alert band and the label is the band the score actually falls
 * into (content/instruments/*.json). No number of ours is written here.
 */
function bandSignalForAssessment(input: {
  instrument: Instrument;
  total: number;
}): SignalDraft | null {
  const topScore =
    input.instrument.items.length *
    Math.max(...input.instrument.options.map((option) => option.value));
  const alertBand =
    input.instrument.bands.find((band) => band.id === input.instrument.alert?.bandId) ??
    [...input.instrument.bands].sort((left, right) => right.min - left.min)[0];

  if (input.instrument.alert?.totalSignal === false) return null;
  if (!alertBand || input.total < alertBand.min) return null;

  // The label must come from the band the score actually falls into, otherwise a 24
  // reads as "moderately severe".
  const actualBand = input.instrument.bands.find(
    (band) => input.total >= band.min && input.total <= band.max,
  );
  if (!actualBand) return null;

  return {
    kind: "severe_total",
    severity: "high",
    title: `${actualBand.label}: ${input.total} из ${topScore}`,
    detail: `Сумма ответов попала в диапазон «${actualBand.label}» (${actualBand.min}–${actualBand.max}).`,
    ruleId: null,
  };
}

export function signalsForDiary(input: { value: number; previousValue: number | null }): SignalDraft[] {
  return signalsFromRules({
    ...NO_FACTS,
    assessment: null,
    diary: { value: input.value, previousValue: input.previousValue },
  });
}
