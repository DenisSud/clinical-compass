import { describe, expect, it } from "vitest";
import { InvalidAnswers, criticalItems, score } from "./engine.js";
import { instrument } from "./loader.js";
import { optionsOf, type Instrument } from "./schema.js";

const phq9 = instrument("phq-9");
const hadsAnxiety = instrument("hads-anxiety");
const hadsDepression = instrument("hads-depression");
const asq = instrument("asq");

function answers(value: number, overrides: Record<string, number> = {}) {
  const filled = Object.fromEntries(
    Array.from({ length: 9 }, (_, index) => [`q${index + 1}`, value]),
  );
  return { ...filled, ...overrides };
}

function answersOf(source: Instrument, value: number, overrides: Record<string, number> = {}) {
  const filled = Object.fromEntries(source.items.map((item) => [item.id, value]));
  return { ...filled, ...overrides };
}

function maxScore(source: Instrument): number {
  return source.items.reduce(
    (sum, item) => sum + Math.max(...optionsOf(source, item).map((option) => option.value)),
    0,
  );
}

function expectBandsCoverEverything(source: Instrument) {
  const max = maxScore(source);
  for (let total = 0; total <= max; total += 1) {
    const band = source.bands.find((candidate) => total >= candidate.min && total <= candidate.max);
    expect(band, `${source.id}: score ${total} fell outside every band`).toBeDefined();
  }
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

describe("HADS", () => {
  it("is two parts of seven items, each with its own wording of the answers", () => {
    expect(hadsAnxiety?.items).toHaveLength(7);
    expect(hadsDepression?.items).toHaveLength(7);
    expect(optionsOf(hadsAnxiety!, hadsAnxiety!.items[0]!)).toHaveLength(4);
    expect(optionsOf(hadsAnxiety!, hadsAnxiety!.items[0]!)[0]?.label).not.toBe(
      optionsOf(hadsAnxiety!, hadsAnxiety!.items[1]!)[0]?.label,
    );
  });

  it("covers every possible total with a band", () => {
    expectBandsCoverEverything(hadsAnxiety!);
    expectBandsCoverEverything(hadsDepression!);
  });

  it("counts the reversed items by their own values", () => {
    // Пункт 4 тревоги: «определенно, это так» стоит 0, «совсем не могу» — 3.
    const calm = Object.fromEntries(
      hadsAnxiety!.items.map((item) => [
        item.id,
        Math.min(...optionsOf(hadsAnxiety!, item).map((option) => option.value)),
      ]),
    );
    expect(score(hadsAnxiety!, calm).total).toBe(0);
  });

  it("gives each part its own total instead of one number for both", () => {
    const anxiety = score(hadsAnxiety!, answersOf(hadsAnxiety!, 3));
    const depression = score(hadsDepression!, answersOf(hadsDepression!, 1));

    expect(anxiety.total).toBe(21);
    expect(anxiety.band.id).toBe("clinical");
    expect(depression.total).toBe(7);
    expect(depression.band.id).toBe("normal");
  });

  it("refuses a value outside the item's own answers", () => {
    expect(() => score(hadsAnxiety!, answersOf(hadsAnxiety!, 0, { a4: 4 }))).toThrow(InvalidAnswers);
  });

  it("has no critical item: the scale does not ask about suicide", () => {
    expect(criticalItems(hadsAnxiety!, answersOf(hadsAnxiety!, 3))).toEqual([]);
  });
});

describe("ASQ", () => {
  it("loads four yes-or-no questions", () => {
    expect(asq?.items).toHaveLength(4);
    expect(optionsOf(asq!, asq!.items[0]!).map((option) => option.value)).toEqual([0, 1]);
  });

  it("asks questions instead of drawing conclusions", () => {
    for (const item of asq!.items) expect(item.text.trim().endsWith("?")).toBe(true);
  });

  it("covers every possible total with a band", () => {
    expectBandsCoverEverything(asq!);
  });

  it("counts a positive answer and keeps a negative screen out of the alert band", () => {
    expect(score(asq!, answersOf(asq!, 0)).total).toBe(0);
    expect(score(asq!, answersOf(asq!, 0)).band.id).toBe("no-positive");
    expect(score(asq!, answersOf(asq!, 0, { q3: 1 })).total).toBe(1);
    expect(score(asq!, answersOf(asq!, 0, { q3: 1 })).band.id).toBe("positive");
  });

  it("marks only the questions that were answered yes", () => {
    expect(criticalItems(asq!, answersOf(asq!, 0))).toEqual([]);
    expect(criticalItems(asq!, answersOf(asq!, 0, { q3: 1 }))).toEqual(["q3"]);
  });

  it("refuses an answer that is neither yes nor no", () => {
    expect(() => score(asq!, answersOf(asq!, 0, { q1: 2 }))).toThrow(InvalidAnswers);
  });
});
