import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { credentials, type MeResponse } from "../../shared/contracts.js";
import { hashPassword, verifyPassword } from "../auth/password.js";
import { clearSessionCookie, endSession, startSession } from "../auth/session.js";
import { doctors, patients } from "../db/schema.js";

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/.test(error.message);
}

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post("/auth/doctor/signup", async (request, reply) => {
    const parsed = credentials.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "invalid_request", message: "Проверьте email и пароль" });
    }

    const { email, password } = parsed.data;
    try {
      const [doctor] = await app.conn.db
        .insert(doctors)
        .values({
          id: randomUUID(),
          email,
          passwordHash: await hashPassword(password),
          createdAt: new Date().toISOString(),
        })
        .returning();

      if (!doctor) throw new Error("insert returned no row");
      await startSession(app.conn, reply, { role: "doctor", userId: doctor.id });
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
      return reply.code(201).send(body);
    } catch (error) {
      if (isUniqueViolation(error)) {
        return reply.code(409).send({ code: "email_taken", message: "Этот email уже занят" });
      }
      throw error;
    }
  });

  app.post("/auth/patient/signup", async (request, reply) => {
    const parsed = credentials.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "invalid_request", message: "Проверьте email и пароль" });
    }

    const { email, password } = parsed.data;
    try {
      const [patient] = await app.conn.db
        .insert(patients)
        .values({
          id: randomUUID(),
          email,
          passwordHash: await hashPassword(password),
          createdAt: new Date().toISOString(),
        })
        .returning();

      if (!patient) throw new Error("insert returned no row");
      await startSession(app.conn, reply, { role: "patient", userId: patient.id });
      const body: MeResponse = {
        role: "patient",
        profile: {
          id: patient.id,
          email: patient.email,
          name: patient.name,
          doctor: null,
          boundAt: patient.boundAt,
        },
      };
      return reply.code(201).send(body);
    } catch (error) {
      if (isUniqueViolation(error)) {
        return reply.code(409).send({ code: "email_taken", message: "Этот email уже занят" });
      }
      throw error;
    }
  });

  app.post("/auth/doctor/signin", async (request, reply) => {
    const parsed = credentials.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "invalid_request", message: "Проверьте email и пароль" });
    }

    const { email, password } = parsed.data;
    const [doctor] = await app.conn.db.select().from(doctors).where(eq(doctors.email, email)).limit(1);

    if (!doctor || !(await verifyPassword(doctor.passwordHash, password))) {
      return reply.code(401).send({ code: "invalid_credentials", message: "Неверный email или пароль" });
    }

    await startSession(app.conn, reply, { role: "doctor", userId: doctor.id });
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
    return reply.code(200).send(body);
  });

  app.post("/auth/patient/signin", async (request, reply) => {
    const parsed = credentials.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "invalid_request", message: "Проверьте email и пароль" });
    }

    const { email, password } = parsed.data;
    const [patient] = await app.conn.db.select().from(patients).where(eq(patients.email, email)).limit(1);

    if (!patient || !(await verifyPassword(patient.passwordHash, password))) {
      return reply.code(401).send({ code: "invalid_credentials", message: "Неверный email или пароль" });
    }

    await startSession(app.conn, reply, { role: "patient", userId: patient.id });
    const body: MeResponse = {
      role: "patient",
      profile: {
        id: patient.id,
        email: patient.email,
        name: patient.name,
        doctor: null,
        boundAt: patient.boundAt,
      },
    };
    return reply.code(200).send(body);
  });

  app.post("/auth/signout", async (request, reply) => {
    await endSession(app.conn, request);
    clearSessionCookie(reply);
    return reply.code(204).send();
  });
};
