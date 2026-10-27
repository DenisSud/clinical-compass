import { describe, expect, it } from "vitest";
import { InvalidAnswers, criticalItems, score } from "./engine.js";
import { instrument } from "./loader.js";
import { optionsOf, type Instrument } from "./schema.js";

const phq9 = instrument("phq-9");
const hadsAnxiety = instrument("hads-anxiety");
const hadsDepression = instrument("hads-depression");
const uku = instrument("uku");
const hdrs = instrument("hdrs-17");

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

  it("keeps the reversed wording of a4 and d3 at the values the source gives", () => {
    const a4 = hadsAnxiety!.items.find((item) => item.id === "a4");
    const d3 = hadsDepression!.items.find((item) => item.id === "d3");

    expect(optionsOf(hadsAnxiety!, a4!).find((option) => option.label === "совсем не могу")?.value).toBe(3);
    expect(
      optionsOf(hadsAnxiety!, a4!).find((option) => option.label === "определенно, это так")?.value,
    ).toBe(0);
    expect(optionsOf(hadsDepression!, d3!).find((option) => option.label === "совсем не испытываю")?.value).toBe(3);
    expect(
      optionsOf(hadsDepression!, d3!).find((option) => option.label === "практически все время")?.value,
    ).toBe(0);
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

describe("UKU", () => {
  it("is one scale of 48 items, each from 0 to 3 in its own words", () => {
    expect(uku?.items).toHaveLength(48);
    for (const item of uku!.items) {
      expect(optionsOf(uku!, item).map((option) => option.value)).toEqual([0, 1, 2, 3]);
    }
  });

  it("has no total: the band says so instead of naming a severity", () => {
    // Общей суммы у шкалы нет (Q52): единственный диапазон — отказ от суммы, а карточку
    // по сумме отключает alert.totalSignal в файле шкалы.
    expect(score(uku!, answersOf(uku!, 3)).band.label).toBe("Общей суммы нет");
    expect(uku?.alert?.totalSignal).toBe(false);
  });

  it("raises no critical item: у шкалы нет пункта о суициде", () => {
    expect(criticalItems(uku!, answersOf(uku!, 3))).toEqual([]);
  });

  it("refuses a value outside the item's own answers", () => {
    expect(() => score(uku!, answersOf(uku!, 0, { u01: 4 }))).toThrow(InvalidAnswers);
  });
});

describe("HDRS-17", () => {
  it("is filled in by the doctor, not by the patient", () => {
    expect(hdrs?.audience).toBe("doctor");
    expect(phq9?.audience).toBe("patient");
  });

  it("is 17 items with their own options and a band for every total", () => {
    expect(hdrs?.items).toHaveLength(17);
    expectBandsCoverEverything(hdrs!);
    expect(maxScore(hdrs!)).toBe(52);
  });

  it("sums the answers by the key of the source and names the band", () => {
    // Максимум каждого пункта свой: у девяти пунктов 0–4, у восьми 0–2, всего 52.
    const top = Object.fromEntries(
      hdrs!.items.map((item) => [
        item.id,
        Math.max(...optionsOf(hdrs!, item).map((option) => option.value)),
      ]),
    );
    const calm = score(hdrs!, answersOf(hdrs!, 0));
    const severe = score(hdrs!, top);

    expect(calm.total).toBe(0);
    expect(calm.band.label).toBe("Норма");
    expect(severe.total).toBe(52);
    expect(severe.band.label).toBe("Крайне тяжёлая степень");
  });

  it("refuses a value the item does not have", () => {
    // h04 оценивается от 0 до 2: четвёрки у него нет, даже если у других пунктов есть.
    expect(() => score(hdrs!, answersOf(hdrs!, 0, { h04: 4 }))).toThrow(InvalidAnswers);
  });
});
