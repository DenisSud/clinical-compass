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

describe("the status file", () => {
  it("describes exactly the two stages the product has", () => {
    expect([...statuses().keys()].sort()).toEqual(["screening", "treatment"]);
  });

  it("keeps a source on each status: our thresholds are ours until the material arrives", () => {
    for (const status of statuses().values()) {
      expect(status.source.ref.length).toBeGreaterThan(5);
      expect(status.source.status).toBe("placeholder");
    }
  });

  it("rejects a status with no instruments", () => {
    expect(() =>
      parseStatusesFile(file([{ id: "screening", label: "Скрининг", instruments: [], source }])),
    ).toThrow(/instruments/);
  });

  it("rejects the same instrument twice in one status", () => {
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

  it("rejects a status without a source", () => {
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

  it("rejects a status the code does not know", () => {
    expect(() =>
      parseStatusesFile(file([{ id: "remission", label: "Ремиссия", instruments: [{ id: "phq-9", repeatAfterHours: 1 }], source }])),
    ).toThrow(/схему/);
  });

  it("rejects a file that forgot a status the code declares", () => {
    expect(() =>
      parseStatusesFile({
        statuses: [{ id: "screening", label: "Скрининг", instruments: [{ id: "phq-9", repeatAfterHours: 1 }], source }],
      }),
    ).toThrow(/treatment/);
  });
});

describe("the stage follows the doctor's specialty", () => {
  it("gives a therapist screening: the entry point of the case", () => {
    expect(statusForSpecialty("therapist")).toBe("screening");
  });

  it("gives a psychiatrist treatment", () => {
    expect(statusForSpecialty("psychiatrist")).toBe("treatment");
  });
});
