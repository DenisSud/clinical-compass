import { eq } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import type { PatientSummary } from "../../shared/contracts.js";
import { requireRole } from "../auth/guard.js";
import { patients } from "../db/schema.js";

function toSummary(row: typeof patients.$inferSelect): PatientSummary {
  return { id: row.id, email: row.email, name: row.name, boundAt: row.boundAt };
}

export const patientRoutes: FastifyPluginAsync = async (app) => {
  app.get("/patients", { preHandler: requireRole("doctor") }, async (request) => {
    const rows = await app.conn.db
      .select()
      .from(patients)
      .where(eq(patients.doctorId, request.auth!.userId));

    return { patients: rows.map(toSummary) };
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

      if (!patient) {
        return reply.code(404).send({ code: "not_found", message: "Пациент не найден" });
      }
      if (patient.doctorId !== request.auth!.userId) {
        return reply.code(403).send({ code: "forbidden", message: "Этот пациент ведёт другой врач" });
      }

      return { patient: toSummary(patient) };
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

      if (!patient) {
        return reply.code(404).send({ code: "not_found", message: "Пациент не найден" });
      }
      if (patient.doctorId !== request.auth!.userId) {
        return reply.code(403).send({ code: "forbidden", message: "Этот пациент ведёт другой врач" });
      }

      await app.conn.db
        .update(patients)
        .set({ doctorId: null, boundAt: null })
        .where(eq(patients.id, patient.id));

      return reply.code(204).send();
    },
  );
};
