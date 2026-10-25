import { describe, expect, it } from "vitest";
import { instrument } from "../instruments/loader.js";
import { MISSED_DOSES_SIGNAL } from "../prescriptions/schedule.js";
import type { Rule } from "../../shared/rules.js";
import { findRule, listRules } from "./registry.js";
import { SIGNAL_RULE_IDS, signalsForAssessment, signalsForDiary } from "./signals.js";

const phq9 = instrument("phq-9");
if (!phq9) throw new Error("phq-9 missing");
const phq9Form = phq9;

/**
 * Rule files that do not raise a signal card yet, each for a stated reason. They are
 * listed instead of silently skipped: a rule that nobody reads is a clinical rule that
 * stopped working, and the parity test must say so.
 *
 * - `adherence-three-missed-doses`: the prescription card is still composed in
 *   `routes/prescriptions.ts` and carries the drug, the missed times and the reasons;
 *   the rule template has no field for them. Its threshold is pinned below so the two
 *   cannot drift until the card moves to the registry.
 * - `aviandr-contraindications`: published through GET /api/rules; no signal path
 *   reads patient facts yet.
 */
const NOT_WIRED = new Set(["adherence-three-missed-doses", "aviandr-contraindications"]);

const SCALE_OR_DIARY_FACTS = new Set([
  "assessment.criticalItem",
  "assessment.totalIncrease",
  "diary.value",
  "diary.drop",
]);

function assessment(total: number, previousTotal: number | null, critical: string[] = []) {
  const answers = Object.fromEntries(phq9Form.items.map((item) => [item.id, 0]));
  for (const id of critical) answers[id] = 1;
  return signalsForAssessment({ instrument: phq9Form, answers, total, previousTotal });
}

function ruleIdsOf(signals: { ruleId: string | null }[]): string[] {
  return signals.flatMap((signal) => (signal.ruleId === null ? [] : [signal.ruleId]));
}

function conditionOf(rule: Rule) {
  const [first] = rule.when;
  if (!first) throw new Error(`правило ${rule.id} без условий`);
  return first;
}

describe("the rule registry and the signal engine are one source", () => {
  it("has a file behind every rule the engine names", () => {
    const registered = new Set(listRules().map((rule) => rule.id));

    for (const id of SIGNAL_RULE_IDS) {
      expect(registered.has(id), `${id} названо в signals.ts, а файла в content/rules нет`).toBe(true);
    }
  });

  it("gives every scale or diary rule a twin in the engine", () => {
    for (const rule of listRules()) {
      if (!rule.when.some((condition) => SCALE_OR_DIARY_FACTS.has(condition.fact))) continue;
      expect(SIGNAL_RULE_IDS, `${rule.id} объявлено, но signals.ts его не читает`).toContain(rule.id);
    }
  });

  it("accounts for every registered rule, and keeps the unwired files in place", () => {
    for (const rule of listRules()) {
      if (SIGNAL_RULE_IDS.includes(rule.id)) continue;
      expect([...NOT_WIRED], `${rule.id} не подключено к сигналам и не названо в NOT_WIRED`).toContain(
        rule.id,
      );
    }

    for (const id of NOT_WIRED) {
      expect(findRule(id), `${id} названо как не-сигнал, но файла нет`).toBeDefined();
    }
  });

  it("raises every wired rule and only wired rules", () => {
    const raised = [
      ...assessment(18, 10),
      ...assessment(1, null, ["q9"]),
      ...signalsForDiary({ value: 2, previousValue: 6 }),
    ];

    expect([...new Set(ruleIdsOf(raised))].sort()).toEqual([...SIGNAL_RULE_IDS].sort());
  });

  it("leaves the instrument band signal to the instrument, without a rule id", () => {
    const band = assessment(18, null).find((signal) => signal.kind === "severe_total");

    expect(band).toBeDefined();
    expect(band!.ruleId).toBeNull();
  });
});

describe("the declared thresholds did not change", () => {
  it("treats five points of worsening as a signal and four as none", () => {
    expect(ruleIdsOf(assessment(14, 10))).not.toContain("worsening");
    expect(ruleIdsOf(assessment(15, 10))).toContain("worsening");
  });

  it("treats a diary value of three as low and four as not", () => {
    expect(ruleIdsOf(signalsForDiary({ value: 4, previousValue: null }))).not.toContain(
      "diary-low-wellbeing",
    );
    expect(ruleIdsOf(signalsForDiary({ value: 3, previousValue: null }))).toContain(
      "diary-low-wellbeing",
    );
  });

  it("treats a three-point diary drop as sharp and two as not", () => {
    expect(ruleIdsOf(signalsForDiary({ value: 8, previousValue: 10 }))).not.toContain(
      "diary-sharp-drop",
    );
    expect(ruleIdsOf(signalsForDiary({ value: 7, previousValue: 10 }))).toContain("diary-sharp-drop");
  });

  it("keeps the prescription threshold equal to the declared adherence rule", () => {
    const rule = findRule("adherence-three-missed-doses");
    expect(rule).toBeDefined();

    expect(conditionOf(rule!)).toMatchObject({
      fact: "adherence.consecutiveMissedDoses",
      atLeast: MISSED_DOSES_SIGNAL,
    });
  });
});
