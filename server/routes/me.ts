import { eq } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import type { MeResponse } from "../../shared/contracts.js";
import { readSession } from "../auth/session.js";
import { doctors, patients } from "../db/schema.js";

export const meRoutes: FastifyPluginAsync = async (app) => {
  app.get("/me", async (request, reply) => {
    const auth = await readSession(app.conn, request);
    if (!auth) {
      return reply.code(401).send({ code: "unauthorized", message: "Нужно войти в аккаунт" });
    }

    if (auth.role === "doctor") {
      const [doctor] = await app.conn.db
        .select()
        .from(doctors)
        .where(eq(doctors.id, auth.userId))
        .limit(1);
      if (!doctor) {
        return reply.code(401).send({ code: "unauthorized", message: "Нужно войти в аккаунт" });
      }
      const body: MeResponse = {
        role: "doctor",
        profile: {
          id: doctor.id,
          email: doctor.email,
          name: doctor.name,
          linkCode: doctor.linkCode,
          linkCodeExpiresAt: doctor.linkCodeExpiresAt,
        },
      };
      return body;
    }

    const [patient] = await app.conn.db
      .select()
      .from(patients)
      .where(eq(patients.id, auth.userId))
      .limit(1);
    if (!patient) {
      return reply.code(401).send({ code: "unauthorized", message: "Нужно войти в аккаунт" });
    }

    const leadingDoctor = patient.doctorId
      ? await app.conn.db.select().from(doctors).where(eq(doctors.id, patient.doctorId)).limit(1)
      : [];

    const body: MeResponse = {
      role: "patient",
      profile: {
        id: patient.id,
        email: patient.email,
        name: patient.name,
        doctor: leadingDoctor[0]
          ? { id: leadingDoctor[0].id, email: leadingDoctor[0].email, name: leadingDoctor[0].name }
          : null,
        boundAt: patient.boundAt,
      },
    };
    return body;
  });
};
