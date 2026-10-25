import { describe, expect, it } from "vitest";
import { instrument } from "../instruments/loader.js";
import { MISSED_DOSES_SIGNAL } from "../prescriptions/schedule.js";
import type { PatientFacts } from "../../shared/contracts.js";
import type { Rule } from "../../shared/rules.js";
import { findRule, listRules } from "./registry.js";
import {
  ALL_SIGNAL_RULE_IDS,
  SIGNAL_RULE_IDS,
  signalsForAdherence,
  signalsForAssessment,
  signalsForDiary,
  signalsForFacts,
} from "./signals.js";

const phq9 = instrument("phq-9");
if (!phq9) throw new Error("phq-9 missing");
const phq9Form = phq9;

/** Conditions that belong to a submission, so their rules must sit in `SIGNAL_RULES`. */
const SCALE_OR_DIARY_FACTS = new Set([
  "assessment.criticalItem",
  "assessment.totalIncrease",
  "diary.value",
  "diary.drop",
]);

function assessment(total: number, previousTotal: number | null, critical: string[] = []) {
  const answers = Object.fromEntries(phq9Form.items.map((item) => [item.id, 0]));
  for (const id of critical) answers[id] = 1;
  return signalsForAssessment({
    instrument: phq9Form,
    answers,
    total,
    previous:
      previousTotal === null
        ? null
        : { instrumentId: phq9Form.id, instrumentVersion: phq9Form.version, total: previousTotal },
  });
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
    for (const id of ALL_SIGNAL_RULE_IDS) {
      expect(findRule(id), `${id} названо в signals.ts, а файла в content/rules нет`).toBeDefined();
    }
  });

  it("gives every scale or diary rule a twin in the engine", () => {
    for (const rule of listRules()) {
      if (!rule.when.some((condition) => SCALE_OR_DIARY_FACTS.has(condition.fact))) continue;
      expect(SIGNAL_RULE_IDS, `${rule.id} объявлено, но signals.ts его не читает`).toContain(rule.id);
    }
  });

  it("leaves no rule file without a path to the doctor", () => {
    // Reachability is the engine's own lists, and there is no exceptions list. The earlier
    // version searched the sources for `requireRule("<id>")`, so a rule mentioned in a
    // comment passed while a dead rule stayed dead, and moving the id into a constant
    // broke a test nothing was wrong with (issue #45). A rule file outside every list
    // has to fail here by name: add it to its list, not to an exception.
    const wired = new Set(ALL_SIGNAL_RULE_IDS);

    for (const rule of listRules()) {
      expect(
        wired.has(rule.id),
        `${rule.id} лежит в content/rules, но ни один список сигналов его не читает`,
      ).toBe(true);
    }
  });

  it("raises the fact rules from the facts on file", () => {
    const blank: PatientFacts = {
      epilepsyOrOrganicBrainDisease: null,
      maoInhibitors: null,
      egfrMlMin: 45,
      childPugh: null,
      pregnancy: "pregnant",
      galactoseIntolerance: null,
    };

    const raised = signalsForFacts(blank);
    expect(raised.map((signal) => signal.ruleId)).toContain("aviandr-contraindications");
    expect(raised[0]?.detail).toContain("беременность");
  });

  it("raises every wired rule and only wired rules", () => {
    const raised = [
      ...assessment(18, 10),
      ...assessment(1, null, ["q9"]),
      ...signalsForDiary({ value: 2, previousValue: 6 }),
    ];

    expect([...new Set(ruleIdsOf(raised))].sort()).toEqual([...SIGNAL_RULE_IDS].sort());
  });

  it("raises the adherence rule from its own list, not from the route", () => {
    const card = signalsForAdherence({
      skipped: [
        { scheduledAt: "2026-10-20T08:00", reason: "не было препарата" },
        { scheduledAt: "2026-10-21T08:00", reason: null },
        { scheduledAt: "2026-10-22T08:00", reason: "забыл" },
      ],
      drugName: "АВИАНДР",
      doseValue: 20,
      doseUnit: "мг",
    });

    expect(card).toHaveLength(1);
    expect(card[0]).toMatchObject({ kind: "missed_doses", ruleId: "adherence-three-missed-doses" });
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
