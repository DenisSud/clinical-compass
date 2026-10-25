import type { DoseSlotState } from "../../shared/contracts.js";

/**
 * Расписание приёмов и приверженность по нему. Всё здесь считается по
 * запланированным временам: «сегодня» — это не единица учёта, а дата, в которую
 * попало запланированное время (decisions.md Q32).
 */

/** Окно сводки: те же две недели, что у отметок плана. */
export const ADHERENCE_WINDOW_DAYS = 14;

/** Сколько пропусков подряд поднимают сигнал приверженности (Q15). */
export const MISSED_DOSES_SIGNAL = 3;

/**
 * Настенный день сервера. Клиника одна и часовой пояс один, поэтому расписание
 * читается в нём: хранить время с зоной значило бы сдвигать приём при переводе часов.
 */
export function wallClockDay(now: Date): string {
  return now.toLocaleDateString("sv-SE");
}

/** «ГГГГ-ММ-ДДTЧЧ:ММ» — формат хранения и сравнения запланированных времён. */
export function wallClockMinute(now: Date): string {
  return `${wallClockDay(now)}T${now.toTimeString().slice(0, 5)}`;
}

export function shiftDay(day: string, days: number): string {
  const parsed = new Date(`${day}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function dayRange(from: string, to: string): string[] {
  const days: string[] = [];
  for (let day = from; day <= to; day = shiftDay(day, 1)) days.push(day);
  return days;
}

export type Schedule = { startsOn: string; endsOn: string | null; timesOfDay: string[] };

/**
 * Запланированные приёмы между двумя днями включительно, по возрастанию времени:
 * внутри дня — по «ЧЧ:ММ», дни — по дате. Пропущенные приёмы считаются по этому
 * списку, а не по календарю.
 */
export function plannedSlots(schedule: Schedule, from: string, to: string): string[] {
  const start = schedule.startsOn > from ? schedule.startsOn : from;
  const end = schedule.endsOn !== null && schedule.endsOn < to ? schedule.endsOn : to;
  if (start > end) return [];

  const times = [...schedule.timesOfDay].sort();
  return dayRange(start, end).flatMap((day) => times.map((time) => `${day}T${time}`));
}

/**
 * Состояние приёма. Время, которое ещё не наступило, — всегда «запланирован», даже
 * если на нём стоит отметка: приём не состоялся и отметка о нём ничего не говорит.
 * Пустая отметка после наступившего времени — «нет данных», а не «пропустил»: пропуск
 * пациент подтверждает сам, иначе неизвестное читалось бы как нарушение.
 */
export function slotState(input: {
  scheduledAt: string;
  mark: { status: DoseSlotState } | undefined;
  now: string;
}): DoseSlotState {
  if (input.scheduledAt > input.now) return "scheduled";
  if (input.mark) return input.mark.status;
  return "no_data";
}

/**
 * Пропуски, идущие подряд к текущему моменту, от старых к новым. «Нет данных»
 * обрывает цепочку: три подряд нельзя утверждать, если один из приёмов неизвестен.
 * Будущие приёмы не участвуют — они ещё не состоялись.
 */
export function trailingSkips<T extends { scheduledAt: string; state: DoseSlotState }>(
  slots: readonly T[],
): T[] {
  const trailing: T[] = [];
  for (const slot of [...slots].reverse()) {
    if (slot.state === "scheduled") continue;
    if (slot.state !== "skipped") break;
    trailing.push(slot);
  }
  return trailing.reverse();
}

/** Разница между запланированным и фактическим временем, в минутах. */
export function lateMinutes(scheduledAt: string, takenAt: string | null): number | null {
  if (takenAt === null) return null;
  const planned = new Date(`${scheduledAt}:00`).getTime();
  return Math.round((new Date(takenAt).getTime() - planned) / 60_000);
}
