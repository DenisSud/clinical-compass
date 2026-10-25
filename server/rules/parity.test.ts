import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { instrument } from "../instruments/loader.js";
import { MISSED_DOSES_SIGNAL } from "../prescriptions/schedule.js";
import type { PatientFacts } from "../../shared/contracts.js";
import type { Rule } from "../../shared/rules.js";
import { findRule, listRules } from "./registry.js";
import {
  ALL_SIGNAL_RULE_IDS,
  SIGNAL_RULE_IDS,
  signalsForAssessment,
  signalsForDiary,
  signalsForFacts,
} from "./signals.js";

const phq9 = instrument("phq-9");
if (!phq9) throw new Error("phq-9 missing");
const phq9Form = phq9;

/**
 * There is no exceptions list any more. Every rule file must be reachable from the
 * engine, and the test says which one is not: a rule nobody reads is a clinical rule
 * that stopped working. The previous version listed «aviandr-contraindications» as
 * unwired and stayed green while a patient with an eGFR of 45 raised nothing (#37).
 */
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

/** Ищет по серверному коду (кроме тестов) прямой вызов requireRule("<id>"). */
function namesRuleInSource(id: string): boolean {
  const root = join(import.meta.dirname, "..");
  const stack = [root];

  while (stack.length > 0) {
    const directory = stack.pop()!;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === "public" || entry.name === "node_modules") continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        stack.push(path);
        continue;
      }
      if (!entry.name.endsWith(".ts") || entry.name.includes(".test.")) continue;
      if (readFileSync(path, "utf8").includes(`requireRule("${id}")`)) return true;
    }
  }

  return false;
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

  it("leaves no rule file without a path to the doctor", () => {
    for (const rule of listRules()) {
      // A rule is reachable either through the engine's lists or through a route that
      // names it explicitly (the pillbox card does). Naming it in code is the point:
      // a file nobody calls is a rule that stopped working.
      const named = namesRuleInSource(rule.id);
      expect(
        named || ALL_SIGNAL_RULE_IDS.includes(rule.id),
        `${rule.id} лежит в content/rules, но ни один путь сигналов его не читает`,
      ).toBe(true);
    }

    for (const id of ALL_SIGNAL_RULE_IDS) {
      expect(findRule(id), `${id} названо в signals.ts, а файла в content/rules нет`).toBeDefined();
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
