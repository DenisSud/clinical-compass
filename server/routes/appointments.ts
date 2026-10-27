import { randomUUID } from "node:crypto";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import {
  appointmentCreateSchema,
  appointmentReminderSchema,
  type Appointment,
} from "../../shared/contracts.js";
import { readSession } from "../auth/session.js";
import { requireAuth, requirePsychiatrist, requireRole } from "../auth/guard.js";
import { appointments, patients } from "../db/schema.js";
import { fail, forbidden, notFound, unauthorized } from "../http/errors.js";
import { loadPatientForDoctor } from "../patient-access.js";

/** Отказ тот же, что у назначений: приём назначает психиатр (SPEC S24, Q49). */
const NOT_YOUR_PATIENT = "Этого пациента ведёт другой врач";

const OTHER_PATIENT = "Это записи другого пациента";

function toAppointment(row: typeof appointments.$inferSelect): Appointment {
  return {
    id: row.id,
    patientId: row.patientId,
    scheduledAt: row.scheduledAt,
    createdAt: row.createdAt,
    cancelledAt: row.cancelledAt,
  };
}

export const appointmentRoutes: FastifyPluginAsync = async (app) => {
  /**
   * Приёмы пациента. Читают двое: врач — карточку своего пациента, пациент — свои
   * записи. Поэтому здесь не requireRole, а отдельная проверка: общего «владельца»
   * у строки нет, у неё есть пациент и его ведущий врач.
   */
  app.get<{ Params: { id: string } }>("/patients/:id/appointments", async (request, reply) => {
    const auth = await readSession(app.conn, request, reply);
    if (!auth) return unauthorized(reply);

    if (auth.role === "doctor") {
      const lookup = await loadPatientForDoctor(app, auth.userId, request.params.id);
      if (!lookup.ok) {
        return lookup.status === 404
          ? notFound(reply, "Пациент не найден")
          : forbidden(reply, NOT_YOUR_PATIENT);
      }
    } else if (auth.userId !== request.params.id) {
      return forbidden(reply, OTHER_PATIENT);
    }

    const rows = await app.conn.db
      .select()
      .from(appointments)
      .where(eq(appointments.patientId, request.params.id))
      .orderBy(desc(appointments.scheduledAt));

    return { appointments: rows.map(toAppointment) };
  });

  /**
   * «Следующий приём» у пациента один. Новый приём отменяет прошлый будущий, а не
   * удаляет его: история приёмов остаётся (SPEC S24, Q49), и перенос отличим от
   * «приёма не было».
   */
  app.post<{ Params: { id: string } }>(
    "/patients/:id/appointments",
    { preHandler: [requireRole("doctor"), requirePsychiatrist()] },
    async (request, reply) => {
      const lookup = await loadPatientForDoctor(app, requireAuth(request).userId, request.params.id);
      if (!lookup.ok) {
        return lookup.status === 404
          ? notFound(reply, "Пациент не найден")
          : forbidden(reply, NOT_YOUR_PATIENT);
      }

      const parsed = appointmentCreateSchema.safeParse(request.body);
      if (!parsed.success) return fail(reply, 400, "invalid_request", "Проверьте дату и время приёма");

      const now = new Date();
      const scheduledAt = new Date(parsed.data.scheduledAt);
      // Прошедшее время — не «следующий приём», а опечатка: заменить им будущий нельзя.
      if (scheduledAt.getTime() <= now.getTime()) {
        return fail(reply, 400, "appointment_in_past", "Приём назначают на будущее время");
      }

      const nowIso = now.toISOString();
      await app.conn.db
        .update(appointments)
        .set({ cancelledAt: nowIso })
        .where(
          and(
            eq(appointments.patientId, lookup.patient.id),
            isNull(appointments.cancelledAt),
            gt(appointments.scheduledAt, nowIso),
          ),
        );

      const [row] = await app.conn.db
        .insert(appointments)
        .values({
          id: randomUUID(),
          patientId: lookup.patient.id,
          doctorId: lookup.patient.doctorId,
          scheduledAt: scheduledAt.toISOString(),
          createdAt: nowIso,
        })
        .returning();
      if (!row) throw new Error("insert returned no row");

      return reply.code(201).send({ appointment: toAppointment(row) });
    },
  );

  /** Отмена — только будущего приёма: прошедший приём не отменяют, он уже состоялся. */
  app.delete<{ Params: { id: string; appointmentId: string } }>(
    "/patients/:id/appointments/:appointmentId",
    { preHandler: [requireRole("doctor"), requirePsychiatrist()] },
    async (request, reply) => {
      const lookup = await loadPatientForDoctor(app, requireAuth(request).userId, request.params.id);
      if (!lookup.ok) {
        return lookup.status === 404
          ? notFound(reply, "Пациент не найден")
          : forbidden(reply, NOT_YOUR_PATIENT);
      }

      const [row] = await app.conn.db
        .select()
        .from(appointments)
        .where(
          and(
            eq(appointments.id, request.params.appointmentId),
            eq(appointments.patientId, lookup.patient.id),
          ),
        )
        .limit(1);
      if (!row) return notFound(reply, "Приём не найден");

      const nowIso = new Date().toISOString();
      if (row.cancelledAt !== null || row.scheduledAt <= nowIso) {
        return fail(reply, 409, "appointment_not_cancellable", "Этот приём уже нельзя отменить");
      }

      const [cancelled] = await app.conn.db
        .update(appointments)
        .set({ cancelledAt: nowIso })
        .where(eq(appointments.id, row.id))
        .returning();
      if (!cancelled) throw new Error("update returned no row");

      return { appointment: toAppointment(cancelled) };
    },
  );

  /**
   * Напоминание на почту включается по желанию (SPEC S24, Q49). Это предпочтение
   * пациента, а не отправка: продукт писем не шлёт, и маршрут об этом молчит.
   */
  app.put("/appointment-reminder", { preHandler: requireRole("patient") }, async (request, reply) => {
    const parsed = appointmentReminderSchema.safeParse(request.body);
    if (!parsed.success) return fail(reply, 400, "invalid_request", "Проверьте значение настройки");

    await app.conn.db
      .update(patients)
      .set({ remindByEmail: parsed.data.remindByEmail })
      .where(eq(patients.id, requireAuth(request).userId));

    return { remindByEmail: parsed.data.remindByEmail };
  });
};
