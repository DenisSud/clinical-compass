import { and, desc, eq, inArray, lt } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { RuleFacts } from "../../shared/rules.js";
import { assessments, diaryEntries, doseEvents, patientFacts, prescriptions } from "../db/schema.js";
import { criticalItems } from "../instruments/engine.js";
import { instrument } from "../instruments/loader.js";
import { toFacts } from "../patient-facts.js";
import type { DoseSlotState } from "../../shared/contracts.js";
import {
  ADHERENCE_WINDOW_DAYS,
  plannedSlots,
  shiftDay,
  slotState,
  trailingSkips,
  wallClockDay,
  wallClockMinute,
} from "../prescriptions/schedule.js";

/**
 * Всё, что система знает о пациенте на один момент, в форме, которую понимают правила и
 * вопросы. Один сборщик на всех: вопрос, заданный на событии шкалы и на событии приёма,
 * обязан получить один и тот же ответ, иначе «да» зависит от того, какая кнопка нажата.
 *
 * Отсутствие данных — `null`, а не ноль: раннер отличает «нет» от «не спрашивали».
 */
export async function factsFor(
  app: FastifyInstance,
  patientId: string,
  now: Date = new Date(),
): Promise<RuleFacts> {
  return {
    assessment: await assessmentFacts(app, patientId),
    diary: await diaryFacts(app, patientId),
    adherence: await adherenceFacts(app, patientId, now),
    patientFacts: await patientFactsFor(app, patientId),
  };
}

async function assessmentFacts(
  app: FastifyInstance,
  patientId: string,
): Promise<RuleFacts["assessment"]> {
  const [last] = await app.conn.db
    .select()
    .from(assessments)
    .where(eq(assessments.patientId, patientId))
    .orderBy(desc(assessments.submittedAt))
    .limit(1);

  if (!last) return null;

  const [previous] = await app.conn.db
    .select({
      instrumentId: assessments.instrumentId,
      instrumentVersion: assessments.instrumentVersion,
      totalScore: assessments.totalScore,
    })
    .from(assessments)
    .where(
      and(
        eq(assessments.patientId, patientId),
        eq(assessments.instrumentId, last.instrumentId),
        lt(assessments.submittedAt, last.submittedAt),
      ),
    )
    .orderBy(desc(assessments.submittedAt))
    .limit(1);

  const description = instrument(last.instrumentId);
  const answers = JSON.parse(last.answers) as Record<string, number>;

  return {
    instrumentId: last.instrumentId,
    instrumentVersion: last.instrumentVersion,
    instrumentTitle: description?.title ?? last.instrumentId,
    total: last.totalScore,
    previous: previous
      ? {
          instrumentId: previous.instrumentId,
          instrumentVersion: previous.instrumentVersion,
          total: previous.totalScore,
        }
      : null,
    // Шкала, описание которой удалили, не даёт списка пунктов: пустой список — не «нет
    // критических пунктов», а «прочитать нечем», и критический сигнал по ней не поднимется.
    criticalItems: description ? criticalItems(description, answers) : [],
  };
}

async function diaryFacts(
  app: FastifyInstance,
  patientId: string,
): Promise<RuleFacts["diary"]> {
  const rows = await app.conn.db
    .select({ value: diaryEntries.value })
    .from(diaryEntries)
    .where(eq(diaryEntries.patientId, patientId))
    .orderBy(desc(diaryEntries.entryDate), desc(diaryEntries.createdAt))
    .limit(2);

  const [last] = rows;
  if (!last) return null;

  return { value: last.value, previousValue: rows[1]?.value ?? null };
}

/**
 * Пропуски подряд по последним состоявшимся приёмам. Берётся худшее назначение: если
 * пациент пропускает один препарат из двух, приверженность нарушена, и усреднение это
 * спрячет. «Нет данных» обрывает цепочку — три подряд нельзя утверждать, если один
 * приём неизвестен (trailingSkips).
 */
async function adherenceFacts(
  app: FastifyInstance,
  patientId: string,
  now: Date,
): Promise<RuleFacts["adherence"]> {
  // Только действующие назначения: черновик ещё не расписание, снятое — уже не оно.
  const active = await app.conn.db
    .select()
    .from(prescriptions)
    .where(and(eq(prescriptions.patientId, patientId), eq(prescriptions.status, "active")));

  if (active.length === 0) return null;

  const marks = await app.conn.db
    .select()
    .from(doseEvents)
    .where(
      inArray(
        doseEvents.prescriptionId,
        active.map((row) => row.id),
      ),
    );

  const today = wallClockDay(now);
  const nowMinute = wallClockMinute(now);
  let worst: number | null = null;

  for (const row of active) {
    const bySlot = new Map(
      marks.filter((mark) => mark.prescriptionId === row.id).map((mark) => [mark.scheduledAt, mark]),
    );
    const slots = plannedSlots(
      {
        startsOn: row.startsOn,
        endsOn: row.archivedAt === null ? (row.endsOn ?? today) : row.archivedAt.slice(0, 10),
        timesOfDay: JSON.parse(row.timesOfDay) as string[],
      },
      shiftDay(today, -(ADHERENCE_WINDOW_DAYS - 1)),
      today,
    ).map((scheduledAt) => {
      const mark = bySlot.get(scheduledAt);
      return {
        scheduledAt,
        state: slotState({
          scheduledAt,
          mark: mark ? { status: mark.status as DoseSlotState } : undefined,
          now: nowMinute,
        }),
      };
    });

    const missed = trailingSkips(slots).length;
    worst = worst === null ? missed : Math.max(worst, missed);
  }

  return worst === null ? null : { consecutiveMissedDoses: worst };
}

async function patientFactsFor(
  app: FastifyInstance,
  patientId: string,
): Promise<RuleFacts["patientFacts"]> {
  const [row] = await app.conn.db
    .select()
    .from(patientFacts)
    .where(eq(patientFacts.patientId, patientId))
    .limit(1);

  return row ? toFacts(row) : null;
}
