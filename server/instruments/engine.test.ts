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

describe("описания инструментов", () => {
  it("загружает PHQ-9 с девятью пунктами", () => {
    expect(phq9?.items).toHaveLength(9);
  });

  it("покрывает каждую возможную сумму полосой", () => {
    for (let total = 0; total <= 27; total += 1) {
      const band = phq9?.bands.find((candidate) => total >= candidate.min && total <= candidate.max);
      expect(band, `score ${total} fell outside every band`).toBeDefined();
    }
  });
});

describe("оценка", () => {
  it("ставит ноль в минимальную полосу, а не теряет его", () => {
    const result = score(phq9!, answers(0));
    expect(result.total).toBe(0);
    expect(result.band.id).toBe("minimal");
  });

  it("складывает ответы и попадает в подходящую полосу", () => {
    const result = score(phq9!, answers(2));
    expect(result.total).toBe(18);
    expect(result.band.id).toBe("moderately-severe");
  });

  it("доходит до верхней полосы", () => {
    expect(score(phq9!, answers(3)).band.id).toBe("severe");
  });

  it("отказывает в пропущенном пункте", () => {
    const partial = answers(0);
    delete partial.q5;
    expect(() => score(phq9!, partial)).toThrow(InvalidAnswers);
  });

  it("отказывает в значении вне шкалы", () => {
    expect(() => score(phq9!, answers(0, { q3: 7 }))).toThrow(InvalidAnswers);
  });

  it("отказывает в пункте, которого у инструмента нет", () => {
    expect(() => score(phq9!, answers(0, { q99: 1 }))).toThrow(InvalidAnswers);
  });
});

describe("критические пункты", () => {
  it("отмечает пункт 9 только когда на него есть ответ", () => {
    expect(criticalItems(phq9!, answers(0))).toEqual([]);
    expect(criticalItems(phq9!, answers(0, { q9: 1 }))).toEqual(["q9"]);
  });
});

describe("HADS", () => {
  it("это две части по семь пунктов, у каждой свои формулировки ответов", () => {
    expect(hadsAnxiety?.items).toHaveLength(7);
    expect(hadsDepression?.items).toHaveLength(7);
    expect(optionsOf(hadsAnxiety!, hadsAnxiety!.items[0]!)).toHaveLength(4);
    expect(optionsOf(hadsAnxiety!, hadsAnxiety!.items[0]!)[0]?.label).not.toBe(
      optionsOf(hadsAnxiety!, hadsAnxiety!.items[1]!)[0]?.label,
    );
  });

  it("покрывает каждую возможную сумму полосой", () => {
    expectBandsCoverEverything(hadsAnxiety!);
    expectBandsCoverEverything(hadsDepression!);
  });

  it("считает обратные пункты по их собственным значениям", () => {
    // Пункт 4 тревоги: «определенно, это так» стоит 0, «совсем не могу» — 3.
    const calm = Object.fromEntries(
      hadsAnxiety!.items.map((item) => [
        item.id,
        Math.min(...optionsOf(hadsAnxiety!, item).map((option) => option.value)),
      ]),
    );
    expect(score(hadsAnxiety!, calm).total).toBe(0);
  });

  it("сохраняет обратную формулировку a4 и d3 на значениях, которые даёт источник", () => {
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

  it("даёт каждой части свою сумму, а не одно число на обе", () => {
    const anxiety = score(hadsAnxiety!, answersOf(hadsAnxiety!, 3));
    const depression = score(hadsDepression!, answersOf(hadsDepression!, 1));

    expect(anxiety.total).toBe(21);
    expect(anxiety.band.id).toBe("clinical");
    expect(depression.total).toBe(7);
    expect(depression.band.id).toBe("normal");
  });

  it("отказывает в значении вне собственных ответов пункта", () => {
    expect(() => score(hadsAnxiety!, answersOf(hadsAnxiety!, 0, { a4: 4 }))).toThrow(InvalidAnswers);
  });

  it("не имеет критического пункта: шкала не спрашивает о суициде", () => {
    expect(criticalItems(hadsAnxiety!, answersOf(hadsAnxiety!, 3))).toEqual([]);
  });
});

describe("UKU", () => {
  it("это одна шкала из 48 пунктов, каждый от 0 до 3 своими словами", () => {
    expect(uku?.items).toHaveLength(48);
    for (const item of uku!.items) {
      expect(optionsOf(uku!, item).map((option) => option.value)).toEqual([0, 1, 2, 3]);
    }
  });

  it("не имеет суммы: полоса говорит об этом вместо названия тяжести", () => {
    // Общей суммы у шкалы нет (Q52): единственный диапазон — отказ от суммы, а карточку
    // по сумме отключает alert.totalSignal в файле шкалы.
    expect(score(uku!, answersOf(uku!, 3)).band.label).toBe("Общей суммы нет");
    expect(uku?.alert?.totalSignal).toBe(false);
  });

  it("raises no critical item: у шкалы нет пункта о суициде", () => {
    expect(criticalItems(uku!, answersOf(uku!, 3))).toEqual([]);
  });

  it("отказывает в значении вне собственных ответов пункта", () => {
    expect(() => score(uku!, answersOf(uku!, 0, { u01: 4 }))).toThrow(InvalidAnswers);
  });
});

describe("HDRS-17", () => {
  it("заполняется врачом, а не пациентом", () => {
    expect(hdrs?.audience).toBe("doctor");
    expect(phq9?.audience).toBe("patient");
  });

  it("это 17 пунктов со своими вариантами и полоса для каждой суммы", () => {
    expect(hdrs?.items).toHaveLength(17);
    expectBandsCoverEverything(hdrs!);
    expect(maxScore(hdrs!)).toBe(52);
  });

  it("складывает ответы по ключу источника и называет полосу", () => {
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

  it("отказывает в значении, которого у пункта нет", () => {
    // h04 оценивается от 0 до 2: четвёрки у него нет, даже если у других пунктов есть.
    expect(() => score(hdrs!, answersOf(hdrs!, 0, { h04: 4 }))).toThrow(InvalidAnswers);
  });
});
