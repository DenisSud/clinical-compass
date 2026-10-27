import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { RuleFacts } from "../../shared/rules.js";
import { listQuestions } from "./registry.js";
import { answerQuestions } from "./runner.js";

type BenchCase = {
  name: string;
  total: number;
  previousTotal: number | null;
  consecutiveMissedDoses: number | null;
  expect: string[];
};

const file = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "..", "tools", "bench", "decisions-cases.json"), "utf8"),
) as { cases: BenchCase[] };

function factsOf(item: BenchCase): RuleFacts {
  return {
    assessment: {
      instrumentId: "hads-anxiety",
      instrumentVersion: "1.0.0",
      instrumentTitle: "HADS-Т",
      total: item.total,
      previous:
        item.previousTotal === null
          ? null
          : { instrumentId: "hads-anxiety", instrumentVersion: "1.0.0", total: item.previousTotal },
      criticalItems: [],
    },
    diary: null,
    adherence:
      item.consecutiveMissedDoses === null
        ? null
        : { consecutiveMissedDoses: item.consecutiveMissedDoses },
    patientFacts: null,
  };
}

/**
 * Набор случаев бенчмарка — часть проверки, а не украшение отчёта: если движок начнёт
 * отвечать иначе, число «24 из 24» станет ложью. Тест держит файл и движок вместе.
 */
describe("набор случаев бенчмарка", () => {
  it("отвечается так, как в нём записано", () => {
    for (const item of file.cases) {
      const answers = answerQuestions(listQuestions(), factsOf(item));
      expect(
        answers.map((answer) => answer.verdict),
        item.name,
      ).toEqual(item.expect);
    }
  });

  it("покрывает отказ, а не только «да» и «нет»", () => {
    const verdicts = new Set(file.cases.flatMap((item) => item.expect));
    expect(verdicts.has("insufficient")).toBe(true);
    expect(verdicts.has("yes")).toBe(true);
    expect(verdicts.has("no")).toBe(true);
  });
});
