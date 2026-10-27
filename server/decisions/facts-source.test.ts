import { describe, expect, it } from "vitest";
import { factsSourceId } from "./facts.js";

describe("источник карточки вопроса, поднятой фактами", () => {
  it("тот же ответ даёт тот же источник", () => {
    const facts = { egfrMlMin: 45, pregnancy: "no" };

    expect(factsSourceId("p1", facts)).toBe(factsSourceId("p1", { egfrMlMin: 45, pregnancy: "no" }));
  });

  it("изменённый ответ даёт новый источник, иначе закрытая карточка не вернулась бы", () => {
    const before = factsSourceId("p1", { egfrMlMin: 45 });
    const after = factsSourceId("p1", { egfrMlMin: 30 });

    expect(before).not.toBe(after);
  });

  it("разные пациенты с одинаковыми фактами не делят карточку", () => {
    expect(factsSourceId("p1", { egfrMlMin: 45 })).not.toBe(factsSourceId("p2", { egfrMlMin: 45 }));
  });
});
