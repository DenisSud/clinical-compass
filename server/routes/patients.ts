import { eq } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { instrumentChoicesResponseSchema } from "../../shared/contracts.js";
import { requireAuth, requireRole } from "../auth/guard.js";
import { patients } from "../db/schema.js";
import { forbidden, notFound } from "../http/errors.js";
import { patientInstruments } from "../instruments/loader.js";
import { toPatientSummary } from "./profiles.js";

const NOT_YOURS = "Этот пациент ведёт другой врач";

export const patientRoutes: FastifyPluginAsync = async (app) => {
  /**
   * Шкалы, назначенные пациенту сейчас. Врачу они нужны для правила «сумма выше порога»:
   * правило на шкалу, которую пациент пройти не может, не сработает ни разу.
   */
  app.get<{ Params: { id: string } }>(
    "/patients/:id/instruments",
    { preHandler: requireRole("doctor") },
    async (request, reply) => {
      const [patient] = await app.conn.db
        .select()
        .from(patients)
        .where(eq(patients.id, request.params.id))
        .limit(1);

      if (!patient) return notFound(reply, "Пациент не найден");
      if (patient.doctorId !== requireAuth(request).userId) return forbidden(reply, NOT_YOURS);

      return instrumentChoicesResponseSchema.parse({
        instruments: patientInstruments(patient.status).map(({ id, title }) => ({ id, title })),
      });
    },
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
