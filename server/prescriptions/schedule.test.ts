import { describe, expect, it } from "vitest";
import type { DoseSlotState } from "../../shared/contracts.js";
import { lateMinutes, plannedSlots, slotState, trailingSkips } from "./schedule.js";

const twiceDaily = { startsOn: "2026-10-20", endsOn: null, timesOfDay: ["20:00", "08:00"] };

function slot(scheduledAt: string, state: DoseSlotState) {
  return { scheduledAt, state };
}

describe("plannedSlots", () => {
  it("упорядочивает приёмы по запланированному времени, а не в порядке ввода врача", () => {
    expect(plannedSlots(twiceDaily, "2026-10-20", "2026-10-21")).toEqual([
      "2026-10-20T08:00",
      "2026-10-20T20:00",
      "2026-10-21T08:00",
      "2026-10-21T20:00",
    ]);
  });

  it("начинает с даты начала назначения, а не с края окна", () => {
    expect(plannedSlots(twiceDaily, "2026-10-01", "2026-10-20")).toEqual([
      "2026-10-20T08:00",
      "2026-10-20T20:00",
    ]);
  });

  it("останавливается на дате окончания, поэтому законченный курс ничего не планирует", () => {
    const course = { ...twiceDaily, endsOn: "2026-10-20" };
    expect(plannedSlots(course, "2026-10-18", "2026-10-25")).toEqual([
      "2026-10-20T08:00",
      "2026-10-20T20:00",
    ]);
  });

  it("ничего не даёт до начала и после окончания", () => {
    expect(plannedSlots({ ...twiceDaily, endsOn: "2026-10-19" }, "2026-10-25", "2026-10-26")).toEqual([]);
  });
});

describe("slotState", () => {
  const now = "2026-10-21T12:00";

  it("читает наступившее время без отметки как отсутствие сведений, а не как пропущенный приём", () => {
    expect(slotState({ scheduledAt: "2026-10-21T08:00", mark: undefined, now })).toBe("no_data");
  });

  it("не включает время, которое ещё не наступило, в счёт отсутствия сведений", () => {
    expect(slotState({ scheduledAt: "2026-10-21T20:00", mark: undefined, now })).toBe("scheduled");
  });

  it("читает текущую минуту как уже наступившую, а не как ещё запланированную", () => {
    // Граница минуты: приём в 12:00 в 12:00 наступил. Строгое «>» — решение, а не
    // случайность, и оно одно с POST /api/doses (issue #47).
    expect(slotState({ scheduledAt: now, mark: undefined, now })).toBe("no_data");
    expect(slotState({ scheduledAt: now, mark: { status: "taken" }, now })).toBe("taken");
  });

  it("берёт собственную отметку пациента как она есть", () => {
    expect(slotState({ scheduledAt: "2026-10-21T08:00", mark: { status: "taken" }, now })).toBe("taken");
    expect(slotState({ scheduledAt: "2026-10-21T08:00", mark: { status: "skipped" }, now })).toBe(
      "skipped",
    );
    expect(slotState({ scheduledAt: "2026-10-21T08:00", mark: { status: "no_data" }, now })).toBe(
      "no_data",
    );
  });

  it("не читает отметку на ненаступившее время как приём", () => {
    expect(slotState({ scheduledAt: "2026-10-21T20:00", mark: { status: "skipped" }, now })).toBe(
      "scheduled",
    );
    expect(slotState({ scheduledAt: "2026-10-21T20:00", mark: { status: "taken" }, now })).toBe(
      "scheduled",
    );
  });
});

describe("три пропущенных приёма подряд", () => {
  it("считает по запланированному времени, поэтому три приёма за полтора дня это три", () => {
    const slots = [
      slot("2026-10-20T08:00", "skipped"),
      slot("2026-10-20T20:00", "skipped"),
      slot("2026-10-21T08:00", "skipped"),
    ];
    expect(trailingSkips(slots).map((entry) => entry.scheduledAt)).toEqual([
      "2026-10-20T08:00",
      "2026-10-20T20:00",
      "2026-10-21T08:00",
    ]);
  });

  it("ломается одним приёмом без сведений, а не считается сквозь него", () => {
    const slots = [
      slot("2026-10-19T08:00", "skipped"),
      slot("2026-10-20T08:00", "no_data"),
      slot("2026-10-21T08:00", "skipped"),
      slot("2026-10-22T08:00", "skipped"),
    ];
    expect(trailingSkips(slots)).toHaveLength(2);
  });

  it("ломается приёмом, который пациент выполнил", () => {
    const slots = [
      slot("2026-10-20T08:00", "skipped"),
      slot("2026-10-20T20:00", "skipped"),
      slot("2026-10-21T08:00", "taken"),
      slot("2026-10-21T20:00", "skipped"),
    ];
    expect(trailingSkips(slots)).toHaveLength(1);
  });

  it("не даёт ненаступившему приёму спрятать серию за ним", () => {
    const slots = [
      slot("2026-10-20T08:00", "skipped"),
      slot("2026-10-20T20:00", "skipped"),
      slot("2026-10-21T08:00", "skipped"),
      slot("2026-10-21T20:00", "scheduled"),
    ];
    expect(trailingSkips(slots)).toHaveLength(3);
  });
});

describe("lateMinutes", () => {
  it("измеряет разницу между запланированным и фактическим временем", () => {
    const takenAt = new Date("2026-10-20T10:30:00").toISOString();
    expect(lateMinutes("2026-10-20T08:00", takenAt)).toBe(150);
  });

  it("не имеет ответа для приёма, которого не было", () => {
    expect(lateMinutes("2026-10-20T08:00", null)).toBeNull();
  });
});
