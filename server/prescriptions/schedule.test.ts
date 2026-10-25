import { describe, expect, it } from "vitest";
import type { DoseSlotState } from "../../shared/contracts.js";
import { lateMinutes, plannedSlots, slotState, trailingSkips } from "./schedule.js";

const twiceDaily = { startsOn: "2026-10-20", endsOn: null, timesOfDay: ["20:00", "08:00"] };

function slot(scheduledAt: string, state: DoseSlotState) {
  return { scheduledAt, state };
}

describe("plannedSlots", () => {
  it("orders intakes by planned time, not the order the doctor typed them", () => {
    expect(plannedSlots(twiceDaily, "2026-10-20", "2026-10-21")).toEqual([
      "2026-10-20T08:00",
      "2026-10-20T20:00",
      "2026-10-21T08:00",
      "2026-10-21T20:00",
    ]);
  });

  it("starts at the prescription's start date, not at the edge of the window", () => {
    expect(plannedSlots(twiceDaily, "2026-10-01", "2026-10-20")).toEqual([
      "2026-10-20T08:00",
      "2026-10-20T20:00",
    ]);
  });

  it("stops at the end date, so a finished course schedules nothing", () => {
    const course = { ...twiceDaily, endsOn: "2026-10-20" };
    expect(plannedSlots(course, "2026-10-18", "2026-10-25")).toEqual([
      "2026-10-20T08:00",
      "2026-10-20T20:00",
    ]);
  });

  it("gives nothing before the start and after the end", () => {
    expect(plannedSlots({ ...twiceDaily, endsOn: "2026-10-19" }, "2026-10-25", "2026-10-26")).toEqual([]);
  });
});

describe("slotState", () => {
  const now = "2026-10-21T12:00";

  it("reads an unmarked slot that has come as no data, never as a missed dose", () => {
    expect(slotState({ scheduledAt: "2026-10-21T08:00", mark: undefined, now })).toBe("no_data");
  });

  it("keeps a slot that has not come yet out of the no-data count", () => {
    expect(slotState({ scheduledAt: "2026-10-21T20:00", mark: undefined, now })).toBe("scheduled");
  });

  it("reads the current minute as already come, not as still scheduled", () => {
    // Граница минуты: приём в 12:00 в 12:00 наступил. Строгое «>» — решение, а не
    // случайность, и оно одно с POST /api/doses (issue #47).
    expect(slotState({ scheduledAt: now, mark: undefined, now })).toBe("no_data");
    expect(slotState({ scheduledAt: now, mark: { status: "taken" }, now })).toBe("taken");
  });

  it("takes the patient's own mark as it is", () => {
    expect(slotState({ scheduledAt: "2026-10-21T08:00", mark: { status: "taken" }, now })).toBe("taken");
    expect(slotState({ scheduledAt: "2026-10-21T08:00", mark: { status: "skipped" }, now })).toBe(
      "skipped",
    );
    expect(slotState({ scheduledAt: "2026-10-21T08:00", mark: { status: "no_data" }, now })).toBe(
      "no_data",
    );
  });

  it("does not read a mark on a time that has not come as an intake", () => {
    expect(slotState({ scheduledAt: "2026-10-21T20:00", mark: { status: "skipped" }, now })).toBe(
      "scheduled",
    );
    expect(slotState({ scheduledAt: "2026-10-21T20:00", mark: { status: "taken" }, now })).toBe(
      "scheduled",
    );
  });
});

describe("three skipped intakes in a row", () => {
  it("counts by planned time, so three intakes in a day and a half are three", () => {
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

  it("is broken by a single intake with no data, not counted through it", () => {
    const slots = [
      slot("2026-10-19T08:00", "skipped"),
      slot("2026-10-20T08:00", "no_data"),
      slot("2026-10-21T08:00", "skipped"),
      slot("2026-10-22T08:00", "skipped"),
    ];
    expect(trailingSkips(slots)).toHaveLength(2);
  });

  it("is broken by an intake the patient took", () => {
    const slots = [
      slot("2026-10-20T08:00", "skipped"),
      slot("2026-10-20T20:00", "skipped"),
      slot("2026-10-21T08:00", "taken"),
      slot("2026-10-21T20:00", "skipped"),
    ];
    expect(trailingSkips(slots)).toHaveLength(1);
  });

  it("does not let an intake that has not come yet hide the run behind it", () => {
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
  it("measures the difference between the planned and the actual time", () => {
    const takenAt = new Date("2026-10-20T10:30:00").toISOString();
    expect(lateMinutes("2026-10-20T08:00", takenAt)).toBe(150);
  });

  it("has no answer for an intake that did not happen", () => {
    expect(lateMinutes("2026-10-20T08:00", null)).toBeNull();
  });
});
