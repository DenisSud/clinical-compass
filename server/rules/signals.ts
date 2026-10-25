import type { PatientFacts } from "../../shared/contracts.js";
import type { PreviousAssessment, RuleFacts, RuleSeverity } from "../../shared/rules.js";
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
 * Rules that read the facts row. They are listed apart from `SIGNAL_RULES` because
 * they fire on `PUT /api/facts`, not on a submission: `SIGNAL_RULE_IDS` is the
 * assessment-and-diary contract the parity test pins, and a fact rule cannot be raised
 * by a questionnaire that never sees the facts.
 */
export const FACT_SIGNAL_RULES = [
  { kind: "contraindication", ruleId: "aviandr-contraindications" },
] as const;

/**
 * Rules that read the dose marks of a prescription. Listed apart for the same reason:
 * they fire on `POST /api/doses`, and the card they raise names the drug, the dose and
 * the missed times, which no questionnaire carries. The list is what the parity test
 * reads; the card itself is built by `signalsForAdherence` below, not by the route (#45).
 */
export const ADHERENCE_SIGNAL_RULES = [
  { kind: "missed_doses", ruleId: "adherence-three-missed-doses" },
] as const;

type SignalRule = { kind: string; ruleId: string };

/**
 * Every rule the engine can raise. A rule file outside this list has no path to the
 * doctor, and the parity test says so by name — the mention of a rule id anywhere in
 * the source, comment or constant, is not a path (issue #45).
 */
export const ALL_SIGNAL_RULE_IDS: readonly string[] = [
  ...SIGNAL_RULE_IDS,
  ...FACT_SIGNAL_RULES.map(({ ruleId }) => ruleId),
  ...ADHERENCE_SIGNAL_RULES.map(({ ruleId }) => ruleId),
];

/**
 * Facts in, signals out. This module supplies only what the registry cannot know how
 * to read; every threshold and every word shown to the doctor comes from the rule file.
 */
function signalsFromRules(rules: readonly SignalRule[], facts: RuleFacts): SignalDraft[] {
  return rules.flatMap(({ kind, ruleId }) => {
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
 *
 * The previous submission arrives as a value that names its scale and version, not
 * as a bare number: a comparison between two scales cannot be expressed here at all
 * (decisions.md §4).
 */
export function signalsForAssessment(input: {
  instrument: Instrument;
  answers: Record<string, number>;
  total: number;
  previous: PreviousAssessment | null;
}): SignalDraft[] {
  const signals = signalsFromRules(SIGNAL_RULES, {
    ...NO_FACTS,
    assessment: {
      instrumentId: input.instrument.id,
      instrumentVersion: input.instrument.version,
      instrumentTitle: input.instrument.title,
      total: input.total,
      previous: input.previous,
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
  return signalsFromRules(SIGNAL_RULES, {
    ...NO_FACTS,
    assessment: null,
    diary: { value: input.value, previousValue: input.previousValue },
  });
}

/**
 * Patient facts in, signals out. Called by `PUT /api/facts`, which is the only moment
 * a fact appears: a contraindication stored and never raised is a rule the doctor
 * never reads (issue #37). The playground calls this same function, so «the facts
 * produce a signal» is one statement in the product and in the playground (issue #42).
 *
 * An unanswered fact is `null`, and "no" is an answer: neither matches a condition, so
 * neither raises anything. A signal already raised is not withdrawn here — closing it
 * takes the doctor's outcome (decisions.md Q17).
 */
export function signalsForFacts(patientFacts: PatientFacts): SignalDraft[] {
  return signalsFromRules(FACT_SIGNAL_RULES, {
    assessment: null,
    diary: null,
    adherence: null,
    patientFacts,
  });
}

/** A missed intake the card may name: when it was planned, and what the patient said. */
export type MissedDose = { scheduledAt: string; reason: string | null };

/** How many missed intakes the card names; the rest stay in the count above. */
const MAX_LISTED_SKIPS = 3;

function formatSlot(scheduledAt: string): string {
  const [date = "", time = ""] = scheduledAt.split("T");
  const [, month = "", day = ""] = date.split("-");
  return `${day}.${month}, ${time}`;
}

/**
 * The adherence card: the run of missed intakes, oldest first. Threshold, severity,
 * title and the general wording come from `content/rules/adherence-three-missed-doses.json`
 * through the registry; this function adds only what a rule template cannot know —
 * the drug, the dose, the times that were missed and the patient's own reasons.
 *
 * The card is built here rather than in the route: a card assembled on the route would
 * need the route to name the rule, and «this rule reaches the doctor» would again rest
 * on a mention in the source text (issue #45).
 */
export function signalsForAdherence(input: {
  /** Missed intakes in a row up to now, oldest first. */
  skipped: readonly MissedDose[];
  drugName: string;
  doseValue: number;
  doseUnit: string;
}): SignalDraft[] {
  const signals = signalsFromRules(ADHERENCE_SIGNAL_RULES, {
    assessment: null,
    diary: null,
    adherence: { consecutiveMissedDoses: input.skipped.length },
    patientFacts: null,
  });

  const listed = input.skipped.slice(-MAX_LISTED_SKIPS);
  const times = listed.map((slot) => formatSlot(slot.scheduledAt));
  const reasons = listed.flatMap((slot) => (slot.reason === null ? [] : [slot.reason]));

  return signals.map((signal) => ({
    ...signal,
    detail:
      `${signal.detail} «${input.drugName}», ${input.doseValue} ${input.doseUnit}: пропущены приёмы ${times.join(", ")}.` +
      (reasons.length > 0 ? ` Причины: ${reasons.join("; ")}.` : ""),
  }));
}
