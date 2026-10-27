import { describe, expect, it } from "vitest";
import { parseStatusesFile, statusForSpecialty, statuses } from "./statuses.js";

const source = { kind: "ours", ref: "sources-needed.md#1.1", status: "placeholder" };

const base = [
  { id: "screening", label: "Скрининг", instruments: [{ id: "phq-9", repeatAfterHours: 336 }], source },
  { id: "treatment", label: "Терапия", instruments: [{ id: "hads-anxiety", repeatAfterHours: 720 }], source },
];

/** Заменяет статус с тем же id, а не дописывает второй: иначе любой override даёт дубль. */
function file(replacements: { id: string; [key: string]: unknown }[] = []): Record<string, unknown> {
  return {
    statuses: [...base.filter((status) => !replacements.some((item) => item.id === status.id)), ...replacements],
  };
}

describe("файл статусов", () => {
  it("описывает ровно те два этапа, которые есть в продукте", () => {
    expect([...statuses().keys()].sort()).toEqual(["screening", "treatment"]);
  });

  it("держит источник у каждого статуса: наши пороги наши, пока не пришёл материал", () => {
    for (const status of statuses().values()) {
      expect(status.source.ref.length).toBeGreaterThan(5);
      expect(status.source.status).toBe("placeholder");
    }
  });

  it("отклоняет статус без инструментов", () => {
    expect(() =>
      parseStatusesFile(file([{ id: "screening", label: "Скрининг", instruments: [], source }])),
    ).toThrow(/instruments/);
  });

  it("отклоняет один и тот же инструмент дважды в одном статусе", () => {
    expect(() =>
      parseStatusesFile(
        file([
          {
            id: "screening",
            label: "Скрининг",
            instruments: [
              { id: "phq-9", repeatAfterHours: 1 },
              { id: "phq-9", repeatAfterHours: 2 },
            ],
            source,
          },
        ]),
      ),
    ).toThrow(/указан дважды/);
  });

  it("отклоняет статус без источника", () => {
    expect(() =>
      parseStatusesFile(file([{ id: "screening", label: "Скрининг", instruments: [{ id: "phq-9", repeatAfterHours: 1 }] }])),
    ).toThrow(/source/);
  });

  it("rejects a third stage: «ухудшение» — сигнал, а не этап", () => {
    expect(() =>
      parseStatusesFile(
        file([
          { id: "worsening", label: "Ухудшение", instruments: [{ id: "hads-anxiety", repeatAfterHours: 1 }], source },
        ]),
      ),
    ).toThrow(/схему/);
  });

  it("отклоняет статус, которого не знает код", () => {
    expect(() =>
      parseStatusesFile(file([{ id: "remission", label: "Ремиссия", instruments: [{ id: "phq-9", repeatAfterHours: 1 }], source }])),
    ).toThrow(/схему/);
  });

  it("отклоняет файл, в котором забыт статус, объявленный кодом", () => {
    expect(() =>
      parseStatusesFile({
        statuses: [{ id: "screening", label: "Скрининг", instruments: [{ id: "phq-9", repeatAfterHours: 1 }], source }],
      }),
    ).toThrow(/treatment/);
  });
});

describe("этап следует за специальностью врача", () => {
  it("даёт терапевту скрининг: входную точку кейса", () => {
    expect(statusForSpecialty("therapist")).toBe("screening");
  });

  it("даёт психиатру терапию", () => {
    expect(statusForSpecialty("psychiatrist")).toBe("treatment");
  });
});
