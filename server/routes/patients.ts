import { eq } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import {
  patientStatusUpdateSchema,
  patientStatusesResponseSchema,
  type PatientSummary,
} from "../../shared/contracts.js";
import { requireAuth, requireRole } from "../auth/guard.js";
import { fail } from "../http/errors.js";
import { patients } from "../db/schema.js";
import { forbidden, notFound } from "../http/errors.js";
import { statuses } from "../instruments/statuses.js";
import { toPatientSummary } from "./profiles.js";

const NOT_YOURS = "Этот пациент ведёт другой врач";

export const patientRoutes: FastifyPluginAsync = async (app) => {
  /** Перечень статусов и их подписей — для выбора в карточке, а не для пациента. */
  app.get("/patient-statuses", { preHandler: requireRole("doctor") }, async () =>
    patientStatusesResponseSchema.parse({
      statuses: [...statuses().values()].map(({ id, label }) => ({ id, label })),
    }),
  );

  app.get("/patients", { preHandler: requireRole("doctor") }, async (request) => {
    const rows = await app.conn.db
      .select()
      .from(patients)
      .where(eq(patients.doctorId, requireAuth(request).userId));

    return { patients: rows.map(toPatientSummary) };
  });

  app.get<{ Params: { id: string } }>(
    "/patients/:id",
    { preHandler: requireRole("doctor") },
    async (request, reply) => {
      const [patient] = await app.conn.db
        .select()
        .from(patients)
        .where(eq(patients.id, request.params.id))
        .limit(1);

      if (!patient) return notFound(reply, "Пациент не найден");
      if (patient.doctorId !== requireAuth(request).userId) return forbidden(reply, NOT_YOURS);

      return { patient: toPatientSummary(patient) };
    },
  );

  /**
   * Один маркер вместо списка назначений: статус выбирает набор опросников из файла
   * (issue #68). Смена статуса не трогает прошлые отправки — динамика остаётся.
   */
  app.patch<{ Params: { id: string } }>(
    "/patients/:id/status",
    { preHandler: requireRole("doctor") },
    async (request, reply) => {
      const parsed = patientStatusUpdateSchema.safeParse(request.body);
      if (!parsed.success) return fail(reply, 400, "invalid_request", "Неизвестный статус");

      const [patient] = await app.conn.db
        .select()
        .from(patients)
        .where(eq(patients.id, request.params.id))
        .limit(1);

      if (!patient) return notFound(reply, "Пациент не найден");
      if (patient.doctorId !== requireAuth(request).userId) return forbidden(reply, NOT_YOURS);

      await app.conn.db
        .update(patients)
        .set({ status: parsed.data.status })
        .where(eq(patients.id, patient.id));

      const summary: PatientSummary = toPatientSummary({ ...patient, status: parsed.data.status });
      return { patient: summary };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/patients/:id/unbind",
    { preHandler: requireRole("doctor") },
    async (request, reply) => {
      const [patient] = await app.conn.db
        .select()
        .from(patients)
        .where(eq(patients.id, request.params.id))
        .limit(1);

      if (!patient) return notFound(reply, "Пациент не найден");
      if (patient.doctorId !== requireAuth(request).userId) return forbidden(reply, NOT_YOURS);

      await app.conn.db
        .update(patients)
        .set({ doctorId: null, boundAt: null })
        .where(eq(patients.id, patient.id));

      return reply.code(204).send();
    },
  );
};
