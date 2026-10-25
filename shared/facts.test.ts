import { describe, expect, it } from "vitest";
import { patientFactsSchema, type PatientFacts } from "./contracts.js";
import {
  FACT_QUESTIONS,
  NOT_ASKED_LABEL,
  UNANSWERED_ANSWER_LABEL,
  factAnswerText,
  factState,
} from "./facts.js";

const FACT_KEYS = Object.keys(patientFactsSchema.shape) as (keyof PatientFacts)[];

const NOTHING_ANSWERED: PatientFacts = {
  epilepsyOrOrganicBrainDisease: null,
  maoInhibitors: null,
  egfrMlMin: null,
  childPugh: null,
  pregnancy: null,
  galactoseIntolerance: null,
};

describe("вопросы о фактах, блокирующих решение", () => {
  it("у каждого поля контракта есть ровно один вопрос", () => {
    expect([...FACT_QUESTIONS.map((question) => question.key)].sort()).toEqual([...FACT_KEYS].sort());
    expect(new Set(FACT_QUESTIONS.map((question) => question.key)).size).toBe(FACT_KEYS.length);
  });

  it("каждый вариант ответа — значение, которое примет контракт", () => {
    for (const question of FACT_QUESTIONS) {
      const field = patientFactsSchema.shape[question.key];

      if (question.kind === "number") {
        expect(field.safeParse(question.min).success).toBe(true);
        expect(field.safeParse(question.max).success).toBe(true);
        expect(field.safeParse(question.max + 1).success).toBe(false);
        continue;
      }

      for (const answer of question.answers) {
        expect(field.safeParse(answer.value).success).toBe(true);
      }
    }
  });

  it("«не знаю» — это отсутствие ответа, а не один из вариантов", () => {
    for (const question of FACT_QUESTIONS) {
      const labels = question.kind === "choice" ? question.answers.map((answer) => answer.label) : [];
      expect(labels).not.toContain(UNANSWERED_ANSWER_LABEL);
      expect(labels).not.toContain(NOT_ASKED_LABEL);
    }
  });

  it("на нетронутых фактах все шесть вопросов — «не спрашивали»", () => {
    expect(FACT_QUESTIONS.map((question) => factState(question.key, NOTHING_ANSWERED))).toEqual(
      Array(FACT_QUESTIONS.length).fill("not_asked"),
    );
    expect(FACT_QUESTIONS.map((question) => factAnswerText(question.key, NOTHING_ANSWERED))).toEqual(
      Array(FACT_QUESTIONS.length).fill(null),
    );
  });

  it("«нет» — это ответ, а не неполнота", () => {
    const answered: PatientFacts = {
      ...NOTHING_ANSWERED,
      epilepsyOrOrganicBrainDisease: "no",
      egfrMlMin: 45,
    };

    expect(factState("epilepsyOrOrganicBrainDisease", answered)).toBe("clear");
    expect(factState("egfrMlMin", answered)).toBe("marked");
    expect(factAnswerText("egfrMlMin", answered)).toBe("45 мл/мин");
    expect(factState("pregnancy", answered)).toBe("not_asked");
  });

  it("в словаре нет ни интерпретации, ни слова «противопоказано»", () => {
    const texts = FACT_QUESTIONS.flatMap((question) => [
      question.label,
      question.question,
      question.hint ?? "",
      ...(question.kind === "choice" ? question.answers.map((answer) => answer.label) : []),
    ]);

    for (const text of texts) {
      expect(text).not.toMatch(/противопоказан|риск|балл|диапазон|динамик|стало|норм/i);
    }
  });
});
