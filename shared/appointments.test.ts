import { describe, expect, it } from "vitest";
import { nextAppointment, reminderDue } from "./appointments.js";
import type { Appointment } from "./contracts.js";

function appointment(scheduledAt: string, cancelledAt: string | null = null): Appointment {
  return {
    id: scheduledAt,
    patientId: "p1",
    scheduledAt,
    createdAt: "2026-10-27T09:00:00.000Z",
    cancelledAt,
  };
}

const NOW = new Date("2026-10-27T09:00:00.000Z");

describe("следующий приём", () => {
  it("берёт ближайший будущий, а не первый в списке", () => {
    const next = nextAppointment(
      [appointment("2026-11-10T09:00:00.000Z"), appointment("2026-11-03T09:00:00.000Z")],
      NOW,
    );

    expect(next?.scheduledAt).toBe("2026-11-03T09:00:00.000Z");
  });

  it("не считает отменённый приём следующим", () => {
    const next = nextAppointment(
      [
        appointment("2026-11-03T09:00:00.000Z", "2026-10-27T10:00:00.000Z"),
        appointment("2026-11-10T09:00:00.000Z"),
      ],
      NOW,
    );

    expect(next?.scheduledAt).toBe("2026-11-10T09:00:00.000Z");
  });

  it("прошедший приём следующим не становится", () => {
    expect(nextAppointment([appointment("2026-10-20T09:00:00.000Z")], NOW)).toBeNull();
  });
});

describe("напоминание о приёме", () => {
  it("появляется только внутри суток до приёма", () => {
    // Три состояния одной строки: раньше окна — нет, внутри — да, после приёма — нет.
    expect(reminderDue({ scheduledAt: "2026-10-28T12:00:00.000Z" }, NOW)).toBe(false);
    expect(reminderDue({ scheduledAt: "2026-10-28T09:00:00.000Z" }, NOW)).toBe(true);
    expect(reminderDue({ scheduledAt: "2026-10-27T09:00:00.000Z" }, NOW)).toBe(true);
    expect(reminderDue({ scheduledAt: "2026-10-26T09:00:00.000Z" }, NOW)).toBe(false);
  });
});
