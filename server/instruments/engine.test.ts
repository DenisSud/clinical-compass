import { describe, expect, it } from "vitest";
import { InvalidAnswers, criticalItems, score } from "./engine.js";
import { instrument } from "./loader.js";

const phq9 = instrument("phq-9");

function answers(value: number, overrides: Record<string, number> = {}) {
  const filled = Object.fromEntries(
    Array.from({ length: 9 }, (_, index) => [`q${index + 1}`, value]),
  );
  return { ...filled, ...overrides };
}

describe("instrument definitions", () => {
  it("loads the PHQ-9 with nine items", () => {
    expect(phq9?.items).toHaveLength(9);
  });

  it("covers every possible total with a band", () => {
    for (let total = 0; total <= 27; total += 1) {
      const band = phq9?.bands.find((candidate) => total >= candidate.min && total <= candidate.max);
      expect(band, `score ${total} fell outside every band`).toBeDefined();
    }
  });
});

describe("score", () => {
  it("puts a zero in the minimal band instead of dropping it", () => {
    const result = score(phq9!, answers(0));
    expect(result.total).toBe(0);
    expect(result.band.id).toBe("minimal");
  });

  it("sums answers and lands in the matching band", () => {
    const result = score(phq9!, answers(2));
    expect(result.total).toBe(18);
    expect(result.band.id).toBe("moderately-severe");
  });

  it("reaches the top band", () => {
    expect(score(phq9!, answers(3)).band.id).toBe("severe");
  });

  it("refuses a missing item", () => {
    const partial = answers(0);
    delete partial.q5;
    expect(() => score(phq9!, partial)).toThrow(InvalidAnswers);
  });

  it("refuses a value outside the scale", () => {
    expect(() => score(phq9!, answers(0, { q3: 7 }))).toThrow(InvalidAnswers);
  });

  it("refuses an item the instrument does not have", () => {
    expect(() => score(phq9!, answers(0, { q99: 1 }))).toThrow(InvalidAnswers);
  });
});

describe("criticalItems", () => {
  it("flags item 9 only when it carries an answer", () => {
    expect(criticalItems(phq9!, answers(0))).toEqual([]);
    expect(criticalItems(phq9!, answers(0, { q9: 1 }))).toEqual(["q9"]);
  });
});
