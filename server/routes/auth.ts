import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { credentialsSchema, type Credentials, type MeResponse } from "../../shared/contracts.js";
import { hashPassword, verifyPassword } from "../auth/password.js";
import { clearSessionCookie, endSession, startSession } from "../auth/session.js";
import { doctors, patients } from "../db/schema.js";
import { fail } from "../http/errors.js";
import { toDoctorProfile, toPatientProfile } from "./profiles.js";

function readCredentials(body: unknown): Credentials | null {
  const parsed = credentialsSchema.safeParse(body);
  return parsed.success ? parsed.data : null;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/.test(error.message);
}

const BAD_CREDENTIALS = "Проверьте email и пароль";

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post("/auth/doctor/signup", async (request, reply) => {
    const credentials = readCredentials(request.body);
    if (!credentials) return fail(reply, 400, "invalid_request", BAD_CREDENTIALS);

    try {
      const [doctor] = await app.conn.db
        .insert(doctors)
        .values({
          id: randomUUID(),
          email: credentials.email,
          passwordHash: await hashPassword(credentials.password),
          createdAt: new Date().toISOString(),
        })
        .returning();
      if (!doctor) throw new Error("insert returned no row");

      await startSession(app.conn, reply, { role: "doctor", userId: doctor.id });
      const body: MeResponse = { role: "doctor", profile: toDoctorProfile(doctor) };
      return reply.code(201).send(body);
    } catch (error) {
      if (isUniqueViolation(error)) return fail(reply, 409, "email_taken", "Этот email уже занят");
      throw error;
    }
  });

  app.post("/auth/patient/signup", async (request, reply) => {
    const credentials = readCredentials(request.body);
    if (!credentials) return fail(reply, 400, "invalid_request", BAD_CREDENTIALS);

    try {
      const [patient] = await app.conn.db
        .insert(patients)
        .values({
          id: randomUUID(),
          email: credentials.email,
          passwordHash: await hashPassword(credentials.password),
          createdAt: new Date().toISOString(),
        })
        .returning();
      if (!patient) throw new Error("insert returned no row");

      await startSession(app.conn, reply, { role: "patient", userId: patient.id });
      const body: MeResponse = { role: "patient", profile: toPatientProfile(patient, undefined) };
      return reply.code(201).send(body);
    } catch (error) {
      if (isUniqueViolation(error)) return fail(reply, 409, "email_taken", "Этот email уже занят");
      throw error;
    }
  });

  app.post("/auth/doctor/signin", async (request, reply) => {
    const credentials = readCredentials(request.body);
    if (!credentials) return fail(reply, 400, "invalid_request", BAD_CREDENTIALS);

    const [doctor] = await app.conn.db
      .select()
      .from(doctors)
      .where(eq(doctors.email, credentials.email))
      .limit(1);

    if (!doctor || !(await verifyPassword(doctor.passwordHash, credentials.password))) {
      return fail(reply, 401, "invalid_credentials", "Неверный email или пароль");
    }

    await startSession(app.conn, reply, { role: "doctor", userId: doctor.id });
    const body: MeResponse = { role: "doctor", profile: toDoctorProfile(doctor) };
    return reply.code(200).send(body);
  });

  app.post("/auth/patient/signin", async (request, reply) => {
    const credentials = readCredentials(request.body);
    if (!credentials) return fail(reply, 400, "invalid_request", BAD_CREDENTIALS);

    const [patient] = await app.conn.db
      .select()
      .from(patients)
      .where(eq(patients.email, credentials.email))
      .limit(1);

    if (!patient || !(await verifyPassword(patient.passwordHash, credentials.password))) {
      return fail(reply, 401, "invalid_credentials", "Неверный email или пароль");
    }

    const leadingDoctor = patient.doctorId ? await findDoctor(app, patient.doctorId) : undefined;
    await startSession(app.conn, reply, { role: "patient", userId: patient.id });
    const body: MeResponse = { role: "patient", profile: toPatientProfile(patient, leadingDoctor) };
    return reply.code(200).send(body);
  });

  app.post("/auth/signout", async (request, reply) => {
    await endSession(app.conn, request);
    clearSessionCookie(reply);
    return reply.code(204).send();
  });
};

async function findDoctor(app: FastifyInstance, doctorId: string) {
  const [doctor] = await app.conn.db.select().from(doctors).where(eq(doctors.id, doctorId)).limit(1);
  return doctor;
}
