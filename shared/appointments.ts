import type { Appointment } from "./contracts.js";

/**
 * За сколько до приёма пациент получает напоминание (SPEC S24, Q49). Срок — правило
 * показа строки, а не срок «отправки»: письмо продукт не отправляет, напоминание
 * живёт на экране пациента.
 */
export const REMINDER_WINDOW_HOURS = 24;

const HOUR_MS = 60 * 60 * 1000;

/** Следующий приём — ближайший будущий и не отменённый; прошедшие в него не попадают. */
export function nextAppointment(
  appointments: readonly Appointment[],
  now: Date,
): Appointment | null {
  const upcoming = appointments.filter(
    (appointment) =>
      appointment.cancelledAt === null && new Date(appointment.scheduledAt).getTime() > now.getTime(),
  );
  if (upcoming.length === 0) return null;

  return upcoming.reduce((soonest, candidate) =>
    new Date(candidate.scheduledAt).getTime() < new Date(soonest.scheduledAt).getTime()
      ? candidate
      : soonest,
  );
}

/**
 * Напоминание — только внутри суток до приёма. Раньше строки нет: пациент и так видит
 * дату, а «напоминание» за неделю не напоминает ни о чём. Прошедший приём не напоминает
 * ни о чём подавно.
 */
export function reminderDue(
  appointment: Pick<Appointment, "scheduledAt">,
  now: Date,
): boolean {
  const remaining = new Date(appointment.scheduledAt).getTime() - now.getTime();
  return remaining >= 0 && remaining <= REMINDER_WINDOW_HOURS * HOUR_MS;
}
