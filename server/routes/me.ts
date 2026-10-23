import { eq } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import type { MeResponse } from "../../shared/contracts.js";
import { readSession } from "../auth/session.js";
import { doctors, patients } from "../db/schema.js";
import { unauthorized } from "../http/errors.js";
import { toDoctorProfile, toPatientProfile } from "./profiles.js";

export const meRoutes: FastifyPluginAsync = async (app) => {
  app.get("/me", async (request, reply) => {
    const auth = await readSession(app.conn, request, reply);
    if (!auth) return unauthorized(reply);

    if (auth.role === "doctor") {
      const [doctor] = await app.conn.db
        .select()
        .from(doctors)
        .where(eq(doctors.id, auth.userId))
        .limit(1);
      if (!doctor) return unauthorized(reply);

      const body: MeResponse = { role: "doctor", profile: toDoctorProfile(doctor) };
      return body;
    }

    const [patient] = await app.conn.db
      .select()
      .from(patients)
      .where(eq(patients.id, auth.userId))
      .limit(1);
    if (!patient) return unauthorized(reply);

    const [leadingDoctor] = patient.doctorId
      ? await app.conn.db.select().from(doctors).where(eq(doctors.id, patient.doctorId)).limit(1)
      : [];

    const body: MeResponse = { role: "patient", profile: toPatientProfile(patient, leadingDoctor) };
    return body;
  });
};
