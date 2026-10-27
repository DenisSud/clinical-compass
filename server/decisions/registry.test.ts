import { describe, expect, it } from "vitest";
import { listQuestions, parseQuestion } from "./registry.js";

const valid = {
  id: "worsening-with-missed-doses",
  question: "Ухудшение совпало с пропусками?",
  when: [
    { fact: "assessment.totalIncrease", atLeast: 5 },
    { fact: "adherence.consecutiveMissedDoses", atLeast: 3 },
  ],
  severity: "high",
  output: { title: "Ухудшение при пропусках", detail: "было {previousTotal}, стало {total}" },
  source: { kind: "ours", ref: "sources-needed.md#1.7", status: "placeholder" },
};

describe("a question file", () => {
  it("loads from content/decisions with its source", () => {
    const questions = listQuestions();

    expect(questions.length).toBeGreaterThan(0);
    for (const question of questions) {
      expect(question.source.ref.length).toBeGreaterThan(5);
      expect(question.when.length).toBeGreaterThan(0);
    }
  });

  it("keeps our thresholds marked as placeholders until the material arrives", () => {
    for (const question of listQuestions()) {
      expect(question.source.status).toBe("placeholder");
    }
  });

  it("refuses a question without a source", () => {
    const { source: _source, ...withoutSource } = valid;

    expect(() => parseQuestion(withoutSource)).toThrow(/source/);
  });

  it("refuses a template name no condition can produce", () => {
    expect(() =>
      parseQuestion({ ...valid, output: { title: "Ухудшение", detail: "пропусков {missed}" } }),
    ).toThrow(/missed/);
  });

  it("refuses a range condition with neither bound", () => {
    expect(() =>
      parseQuestion({
        ...valid,
        when: [{ fact: "adherence.consecutiveMissedDoses" }],
        output: { title: "Ухудшение", detail: "пропусков подряд слишком много" },
      }),
    ).toThrow(/atLeast/);
  });

  it("refuses a question with no conditions", () => {
    expect(() => parseQuestion({ ...valid, when: [] })).toThrow(/when/);
  });
});
