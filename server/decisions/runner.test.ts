import { describe, expect, it } from "vitest";
import { decisionQuestionSchema, type DecisionQuestion } from "../../shared/decisions.js";
import type { RuleFacts } from "../../shared/rules.js";
import { answerQuestions } from "./runner.js";

const source = { kind: "ours", ref: "sources-needed.md#1.7", status: "placeholder" } as const;

const worseningWithMisses: DecisionQuestion = decisionQuestionSchema.parse({
  id: "worsening-with-missed-doses",
  question: "Ухудшение по шкале совпало с пропусками приёма?",
  when: [
    { fact: "assessment.totalIncrease", atLeast: 5 },
    { fact: "adherence.consecutiveMissedDoses", atLeast: 3 },
  ],
  severity: "high",
  output: { title: "Ухудшение при пропусках", detail: "{instrument}: {previousTotal} → {total}, пропусков {missedDoses}" },
  source,
});

const withMisses: RuleFacts = {
  assessment: {
    instrumentId: "phq-9",
    instrumentVersion: "1.0.0",
    instrumentTitle: "PHQ-9",
    total: 18,
    previous: { instrumentId: "phq-9", instrumentVersion: "1.0.0", total: 9 },
    criticalItems: [],
  },
  diary: null,
  adherence: { consecutiveMissedDoses: 3 },
  patientFacts: null,
};

describe("answers to a question", () => {
  it("answers yes when every condition holds", () => {
    const [answer] = answerQuestions([worseningWithMisses], withMisses);

    expect(answer?.verdict).toBe("yes");
    expect(answer?.title).toBe("Ухудшение при пропусках");
    expect(answer?.detail).toBe("PHQ-9: 9 → 18, пропусков 3");
    expect(answer?.severity).toBe("high");
  });

  it("answers no when a condition does not hold", () => {
    const [answer] = answerQuestions([worseningWithMisses], {
      ...withMisses,
      adherence: { consecutiveMissedDoses: 1 },
    });

    expect(answer?.verdict).toBe("no");
    expect(answer?.missing).toEqual([]);
    expect(answer?.title).toBeUndefined();
  });

  it("refuses instead of answering no when the adherence data is absent", () => {
    const [answer] = answerQuestions([worseningWithMisses], { ...withMisses, adherence: null });

    expect(answer?.verdict).toBe("insufficient");
    expect(answer?.missing).toEqual(["нет отметок приёма препаратов"]);
  });

  it("refuses when the previous score belongs to another instrument", () => {
    const [answer] = answerQuestions([worseningWithMisses], {
      ...withMisses,
      assessment: {
        ...withMisses.assessment!,
        previous: { instrumentId: "gad-7", instrumentVersion: "1.0.0", total: 3 },
      },
    });

    expect(answer?.verdict).toBe("insufficient");
    expect(answer?.missing[0]).toContain("другой шкалой");
  });

  it("refuses when the previous score is of another version of the same instrument", () => {
    const [answer] = answerQuestions([worseningWithMisses], {
      ...withMisses,
      assessment: {
        ...withMisses.assessment!,
        previous: { instrumentId: "phq-9", instrumentVersion: "0.9.0", total: 3 },
      },
    });

    expect(answer?.verdict).toBe("insufficient");
    expect(answer?.missing[0]).toContain("версии");
  });

  it("refuses when a patient fact was never asked", () => {
    const question = decisionQuestionSchema.parse({
      ...worseningWithMisses,
      id: "contraindication-worsening",
      when: [
        { fact: "assessment.totalIncrease", atLeast: 1 },
        { fact: "patientFact.egfrMlMin", below: 60, label: "СКФ ниже 60" },
      ],
    });

    const [answer] = answerQuestions([question], {
      ...withMisses,
      patientFacts: {
        epilepsyOrOrganicBrainDisease: null,
        maoInhibitors: null,
        egfrMlMin: null,
        childPugh: null,
        pregnancy: null,
        galactoseIntolerance: null,
      },
    });

    expect(answer?.verdict).toBe("insufficient");
    expect(answer?.missing).toEqual(["не заполнены факты пациента"]);
  });

  it("answers every question in the order given", () => {
    const second = decisionQuestionSchema.parse({ ...worseningWithMisses, id: "second" });
    const answers = answerQuestions([worseningWithMisses, second], withMisses);

    expect(answers.map((answer) => answer.questionId)).toEqual([
      "worsening-with-missed-doses",
      "second",
    ]);
  });
});
