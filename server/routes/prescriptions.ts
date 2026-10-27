import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import {
  doseSubmitSchema,
  prescriptionCreateSchema,
  type DoseBoard,
  type DoseEvent,
  type DoseSlot,
  type DoseSlotState,
  type Prescription,
  type PrescriptionView,
} from "../../shared/contracts.js";
import { requireAuth, requirePsychiatrist, requireRole } from "../auth/guard.js";
import { doseEvents, prescriptions } from "../db/schema.js";
import { fail, forbidden, notFound } from "../http/errors.js";
import { corpus } from "../knowledge/corpus.js";
import { loadPatientForDoctor } from "../patient-access.js";
import {
  ADHERENCE_WINDOW_DAYS,
  lateMinutes,
  plannedSlots,
  shiftDay,
  slotState,
  trailingSkips,
  wallClockDay,
  wallClockMinute,
} from "../prescriptions/schedule.js";
import { signalsForAdherence } from "../rules/signals.js";
import { saveSignals } from "./signals.js";

const REASON_MIN_LENGTH = 3;

function timesOfDayOf(row: typeof prescriptions.$inferSelect): string[] {
  return JSON.parse(row.timesOfDay) as string[];
}

function toPrescription(row: typeof prescriptions.$inferSelect): Prescription {
  return {
    id: row.id,
    patientId: row.patientId,
    drugId: row.drugId,
    drugName: row.drugName,
    doseValue: row.doseValue,
    doseUnit: row.doseUnit,
    timesPerDay: row.timesPerDay,
    timesOfDay: timesOfDayOf(row),
    startsOn: row.startsOn,
    endsOn: row.endsOn,
    status: row.status as Prescription["status"],
    createdAt: row.createdAt,
    confirmedAt: row.confirmedAt,
    confirmedBy: row.confirmedBy,
    archivedAt: row.archivedAt,
  };
}

function toDoseEvent(row: typeof doseEvents.$inferSelect): DoseEvent {
  return {
    id: row.id,
    prescriptionId: row.prescriptionId,
    scheduledAt: row.scheduledAt,
    status: row.status as DoseEvent["status"],
    takenAt: row.takenAt,
    reason: row.reason,
    createdAt: row.createdAt,
  };
}

/** Чем заканчивается расписание: датой конца, днём снятия назначения или сегодняшним днём. */
function scheduleEnd(row: typeof prescriptions.$inferSelect, today: string): string {
  if (row.endsOn !== null) return row.endsOn;
  if (row.archivedAt !== null) return row.archivedAt.slice(0, 10);
  return today;
}

/**
 * Таблетница одного назначения: расписание, отметки и сводка за окно. Представление,
 * а не вторая правда — и времена приёмов, и отметки берутся из своих таблиц.
 * Черновик приёмов не имеет: пока врач не подтвердил, расписания для пациента нет.
 */
function toPrescriptionView(
  row: typeof prescriptions.$inferSelect,
  marks: (typeof doseEvents.$inferSelect)[],
  now: Date,
): PrescriptionView {
  const today = wallClockDay(now);
  const nowMinute = wallClockMinute(now);
  const bySlot = new Map(marks.map((mark) => [mark.scheduledAt, mark]));

  const slots: DoseSlot[] =
    row.status === "draft"
      ? []
      : plannedSlots(
          {
            startsOn: row.startsOn,
            endsOn: scheduleEnd(row, today),
            timesOfDay: timesOfDayOf(row),
          },
          shiftDay(today, -(ADHERENCE_WINDOW_DAYS - 1)),
          today,
        ).map((scheduledAt) => {
          const mark = bySlot.get(scheduledAt);
          return {
            prescriptionId: row.id,
            drugName: row.drugName,
            doseValue: row.doseValue,
            doseUnit: row.doseUnit,
            scheduledAt,
            state: slotState({
              scheduledAt,
              mark: mark ? { status: mark.status as DoseSlotState } : undefined,
              now: nowMinute,
            }),
            takenAt: mark?.takenAt ?? null,
            lateMinutes: lateMinutes(scheduledAt, mark?.takenAt ?? null),
            reason: mark?.reason ?? null,
            eventId: mark?.id ?? null,
          };
        });

  // Состоявшимся считается только наступившее время: будущий приём остаётся
  // «запланирован» и в сводку не попадает (schedule.ts, slotState).
  const elapsed = slots.filter((slot) => slot.state !== "scheduled");

  return {
    prescription: toPrescription(row),
    slots,
    adherence: {
      scheduled: elapsed.length,
      taken: elapsed.filter((slot) => slot.state === "taken").length,
      skipped: elapsed.filter((slot) => slot.state === "skipped").length,
      noData: elapsed.filter((slot) => slot.state === "no_data").length,
      consecutiveSkips: trailingSkips(slots).length,
    },
  };
}

function drugInReference(drugId: string): boolean {
  return corpus().some((document) => document.kind === "smpc" && document.id === drugId);
}

async function marksOf(
  app: FastifyInstance,
  prescriptionIds: string[],
): Promise<Map<string, (typeof doseEvents.$inferSelect)[]>> {
  const byPrescription = new Map<string, (typeof doseEvents.$inferSelect)[]>();
  if (prescriptionIds.length === 0) return byPrescription;

  const rows = await app.conn.db
    .select()
    .from(doseEvents)
    .where(inArray(doseEvents.prescriptionId, prescriptionIds))
    .orderBy(asc(doseEvents.scheduledAt));

  for (const row of rows) {
    const list = byPrescription.get(row.prescriptionId) ?? [];
    list.push(row);
    byPrescription.set(row.prescriptionId, list);
  }
  return byPrescription;
}

export const prescriptionRoutes: FastifyPluginAsync = async (app) => {
  /** Таблетница пациента: только приёмы на сегодня, без интерпретаций и норм. */
  app.get("/prescriptions", { preHandler: requireRole("patient") }, async (request) => {
    const patientId = requireAuth(request).userId;
    const rows = await app.conn.db
      .select()
      .from(prescriptions)
      .where(and(eq(prescriptions.patientId, patientId), eq(prescriptions.status, "active")))
      .orderBy(asc(prescriptions.startsOn));

    const now = new Date();
    const today = wallClockDay(now);
    const marks = await marksOf(app, rows.map((row) => row.id));

    const doses = rows.flatMap((row) =>
      toPrescriptionView(row, marks.get(row.id) ?? [], now).slots.filter(
        (slot) => slot.scheduledAt.slice(0, 10) === today,
      ),
    );

    const board: DoseBoard = { today, doses };
    return board;
  });

  app.post("/doses", { preHandler: requireRole("patient") }, async (request, reply) => {
    const parsed = doseSubmitSchema.safeParse(request.body);
    if (!parsed.success) return fail(reply, 400, "invalid_request", "Некорректная отметка приёма");

    const patientId = requireAuth(request).userId;
    const [row] = await app.conn.db
      .select()
      .from(prescriptions)
      .where(
        and(eq(prescriptions.id, parsed.data.prescriptionId), eq(prescriptions.patientId, patientId)),
      )
      .limit(1);

    if (!row) return notFound(reply, "Назначение не найдено");
    if (row.status !== "active") {
      return fail(reply, 409, "wrong_status", "Это назначение не действует");
    }

    // Отметка привязана к конкретному запланированному времени, а не к дню: иначе
    // два приёма в день снова схлопнулись бы в одну строку.
    const scheduledAt = parsed.data.scheduledAt;
    const day = scheduledAt.slice(0, 10);
    const plannedForDay = plannedSlots(
      { startsOn: row.startsOn, endsOn: row.endsOn, timesOfDay: timesOfDayOf(row) },
      day,
      day,
    );
    if (!plannedForDay.includes(scheduledAt)) {
      return fail(reply, 400, "invalid_request", "Такого приёма нет в расписании");
    }

    const now = new Date();
    const nowMinute = wallClockMinute(now);
    // Время, которое ещё не наступило, — это не приём и не пропуск: отметка на будущее
    // выдумывает факт, которого не было, и поднимает сигнал по приёмам, которых не было.
    // Строгое «>», а не «>=»: отметка ровно на текущую минуту принимается — приём
    // в 12:00 в 12:00 уже наступил. Это решение о границе, а не случайность, и оно
    // закреплено тестом вместе с правилом `slotState` (issue #47).
    if (scheduledAt > nowMinute) {
      return fail(
        reply,
        409,
        "dose_in_future",
        "Это время ещё не наступило — отметить приём можно, когда оно придёт",
      );
    }

    const reason = parsed.data.reason?.trim() ?? "";
    // То же правило, что и в плане: пропуск без причины не даёт врачу ничего, с чем можно работать.
    if (parsed.data.status === "skipped" && reason.length < REASON_MIN_LENGTH) {
      return fail(
        reply,
        400,
        "invalid_request",
        "Опишите, что помешало — без причины пропуск не записывается",
      );
    }

    const createdAt = now.toISOString();
    const [saved] = await app.conn.db
      .insert(doseEvents)
      .values({
        id: randomUUID(),
        prescriptionId: row.id,
        patientId,
        scheduledAt,
        status: parsed.data.status,
        takenAt: parsed.data.status === "taken" ? createdAt : null,
        reason: parsed.data.status === "skipped" ? reason : null,
        createdAt,
      })
      // Случайное нажатие исправляют, а не сохраняют: то же запланированное время перезаписывается.
      .onConflictDoUpdate({
        target: [doseEvents.prescriptionId, doseEvents.scheduledAt],
        set: {
          status: parsed.data.status,
          takenAt: parsed.data.status === "taken" ? createdAt : null,
          reason: parsed.data.status === "skipped" ? reason : null,
          createdAt,
        },
      })
      .returning();
    if (!saved) throw new Error("insert returned no row");

    // Пропуски подряд — сигнал приверженности. Порог, тяжесть, заголовок и источник
    // решает файл правила, карточку собирает движок (`signalsForAdherence`), а роут
    // только передаёт ему пропуски и препарат: своей копии правила у роута нет (#45).
    // Считается по запланированным временам, поэтому «нет данных» его не поднимает
    // и, главное, не выдаёт за приём.
    const marks = await app.conn.db
      .select()
      .from(doseEvents)
      .where(eq(doseEvents.prescriptionId, row.id));
    const view = toPrescriptionView(row, marks, now);

    await saveSignals(app, {
      patientId,
      sourceType: "dose",
      sourceId: saved.id,
      drafts: signalsForAdherence({
        skipped: trailingSkips(view.slots).map((slot) => ({
          scheduledAt: slot.scheduledAt,
          reason: slot.reason,
        })),
        drugName: row.drugName,
        doseValue: row.doseValue,
        doseUnit: row.doseUnit,
      }),
    });

    return reply.code(200).send({ dose: toDoseEvent(saved) });
  });

  app.get<{ Params: { id: string } }>(
    "/patients/:id/prescriptions",
    { preHandler: requireRole("doctor") },
    async (request, reply) => {
      const lookup = await loadPatientForDoctor(app, requireAuth(request).userId, request.params.id);
      if (!lookup.ok) {
        return lookup.status === 404
          ? notFound(reply, "Пациент не найден")
          : forbidden(reply, "Этого пациента ведёт другой врач");
      }

      const rows = await app.conn.db
        .select()
        .from(prescriptions)
        .where(eq(prescriptions.patientId, lookup.patient.id))
        .orderBy(desc(prescriptions.createdAt));

      const now = new Date();
      const marks = await marksOf(app, rows.map((row) => row.id));

      return {
        today: wallClockDay(now),
        prescriptions: rows.map((row) => toPrescriptionView(row, marks.get(row.id) ?? [], now)),
      };
    },
  );

  // Назначает только психиатр (SPEC S7, Q50): у терапевта нет ни формы, ни подтверждения.
  // Чтение выше не закрыто — план психиатра терапевт видит, если пациент ещё за ним.
  app.post<{ Params: { id: string } }>(
    "/patients/:id/prescriptions",
    { preHandler: [requireRole("doctor"), requirePsychiatrist()] },
    async (request, reply) => {
      const lookup = await loadPatientForDoctor(app, requireAuth(request).userId, request.params.id);
      if (!lookup.ok) {
        return lookup.status === 404
          ? notFound(reply, "Пациент не найден")
          : forbidden(reply, "Этого пациента ведёт другой врач");
      }

      const parsed = prescriptionCreateSchema.safeParse(request.body);
      if (!parsed.success) {
        return fail(reply, 400, "invalid_request", "Проверьте препарат, дозу и расписание");
      }

      const drugId = parsed.data.drugId ?? null;
      if (drugId !== null && !drugInReference(drugId)) {
        return fail(reply, 400, "unknown_drug", "Такого препарата нет в справочнике");
      }

      const [row] = await app.conn.db
        .insert(prescriptions)
        .values({
          id: randomUUID(),
          patientId: lookup.patient.id,
          drugId,
          drugName: parsed.data.drugName,
          doseValue: parsed.data.doseValue,
          doseUnit: parsed.data.doseUnit,
          timesPerDay: parsed.data.timesPerDay,
          timesOfDay: JSON.stringify(parsed.data.timesOfDay),
          startsOn: parsed.data.startsOn,
          endsOn: parsed.data.endsOn ?? null,
          status: "draft",
          createdAt: new Date().toISOString(),
        })
        .returning();
      if (!row) throw new Error("insert returned no row");

      return reply.code(201).send({ prescription: toPrescription(row) });
    },
  );

  app.post<{ Params: { id: string } }>(
    "/prescriptions/:id/confirm",
    { preHandler: [requireRole("doctor"), requirePsychiatrist()] },
    async (request, reply) => {
      const found = await loadOwnPrescription(app, requireAuth(request).userId, request.params.id);
      if (!found.ok) return found.reply(reply);
      if (found.row.status !== "draft") {
        return fail(reply, 409, "wrong_status", "Назначение уже подтверждено");
      }

      const [row] = await app.conn.db
        .update(prescriptions)
        .set({
          status: "active",
          confirmedAt: new Date().toISOString(),
          confirmedBy: requireAuth(request).userId,
        })
        .where(eq(prescriptions.id, found.row.id))
        .returning();

      return { prescription: toPrescription(row!) };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/prescriptions/:id/archive",
    { preHandler: [requireRole("doctor"), requirePsychiatrist()] },
    async (request, reply) => {
      const found = await loadOwnPrescription(app, requireAuth(request).userId, request.params.id);
      if (!found.ok) return found.reply(reply);

      const [row] = await app.conn.db
        .update(prescriptions)
        .set({ status: "archived", archivedAt: new Date().toISOString() })
        .where(eq(prescriptions.id, found.row.id))
        .returning();

      return { prescription: toPrescription(row!) };
    },
  );
};

type OwnPrescription =
  | { ok: true; row: typeof prescriptions.$inferSelect }
  | { ok: false; reply: (reply: import("fastify").FastifyReply) => unknown };

async function loadOwnPrescription(
  app: Parameters<FastifyPluginAsync>[0],
  doctorId: string,
  prescriptionId: string,
): Promise<OwnPrescription> {
  const [row] = await app.conn.db
    .select()
    .from(prescriptions)
    .where(eq(prescriptions.id, prescriptionId))
    .limit(1);
  if (!row) return { ok: false, reply: (reply) => notFound(reply, "Назначение не найдено") };

  const lookup = await loadPatientForDoctor(app, doctorId, row.patientId);
  if (!lookup.ok) {
    return {
      ok: false,
      reply: (reply) =>
        lookup.status === 404
          ? notFound(reply, "Пациент не найден")
          : forbidden(reply, "Это назначение относится к пациенту другого врача"),
    };
  }

  return { ok: true, row };
}
