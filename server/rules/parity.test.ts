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

describe("реестр правил и движок сигналов это один источник", () => {
  it("имеет файл за каждым правилом, которое называет движок", () => {
    for (const id of ALL_SIGNAL_RULE_IDS) {
      expect(findRule(id), `${id} названо в signals.ts, а файла в content/rules нет`).toBeDefined();
    }
  });

  it("даёт каждому правилу шкалы или дневника пару в движке", () => {
    for (const rule of listRules()) {
      if (!rule.when.some((condition) => SCALE_OR_DIARY_FACTS.has(condition.fact))) continue;
      expect(SIGNAL_RULE_IDS, `${rule.id} объявлено, но signals.ts его не читает`).toContain(rule.id);
    }
  });

  it("не оставляет ни одного файла правила без пути к врачу", () => {
    // Достижимость это собственные списки движка, списка исключений нет. Прежняя версия искала
    // в исходниках `requireRule("<id>")`, поэтому правило, упомянутое в комментарии, проходило,
    // мёртвое правило оставалось мёртвым, а перенос идентификатора в константу ломал тест,
    // с которым всё было в порядке (issue #45). Файл правила вне любого списка должен падать
    // здесь по имени: добавь его в список, а не в исключение.
    const wired = new Set(ALL_SIGNAL_RULE_IDS);

    for (const rule of listRules()) {
      expect(
        wired.has(rule.id),
        `${rule.id} лежит в content/rules, но ни один список сигналов его не читает`,
      ).toBe(true);
    }
  });

  it("поднимает правила фактов из фактов на диске", () => {
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

  it("поднимает каждое подключённое правило и только подключённые", () => {
    const raised = [
      ...assessment(18, 10),
      ...assessment(1, null, ["q9"]),
      ...signalsForDiary({ value: 2, previousValue: 6 }),
    ];

    expect([...new Set(ruleIdsOf(raised))].sort()).toEqual([...SIGNAL_RULE_IDS].sort());
  });

  it("поднимает правило приверженности из своего списка, а не с маршрута", () => {
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

  it("оставляет сигнал по полосе шкалы инструменту, без идентификатора правила", () => {
    const band = assessment(18, null).find((signal) => signal.kind === "severe_total");

    expect(band).toBeDefined();
    expect(band!.ruleId).toBeNull();
  });
});

describe("объявленные пороги не изменились", () => {
  it("считает пять баллов ухудшения сигналом, а четыре нет", () => {
    expect(ruleIdsOf(assessment(14, 10))).not.toContain("worsening");
    expect(ruleIdsOf(assessment(15, 10))).toContain("worsening");
  });

  it("считает оценку дневника три низкой, а четыре нет", () => {
    expect(ruleIdsOf(signalsForDiary({ value: 4, previousValue: null }))).not.toContain(
      "diary-low-wellbeing",
    );
    expect(ruleIdsOf(signalsForDiary({ value: 3, previousValue: null }))).toContain(
      "diary-low-wellbeing",
    );
  });

  it("считает падение дневника на три балла резким, а на два нет", () => {
    expect(ruleIdsOf(signalsForDiary({ value: 8, previousValue: 10 }))).not.toContain(
      "diary-sharp-drop",
    );
    expect(ruleIdsOf(signalsForDiary({ value: 7, previousValue: 10 }))).toContain("diary-sharp-drop");
  });

  it("держит порог назначения равным объявленному правилу приверженности", () => {
    const rule = findRule("adherence-three-missed-doses");
    expect(rule).toBeDefined();

    expect(conditionOf(rule!)).toMatchObject({
      fact: "adherence.consecutiveMissedDoses",
      atLeast: MISSED_DOSES_SIGNAL,
    });
  });
});
