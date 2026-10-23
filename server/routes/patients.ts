import { eq } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { requireRole } from "../auth/guard.js";
import { patients } from "../db/schema.js";

export const patientRoutes: FastifyPluginAsync = async (app) => {
  app.get("/patients", { preHandler: requireRole("doctor") }, async (request) => {
    const rows = await app.conn.db
      .select()
      .from(patients)
      .where(eq(patients.doctorId, request.auth!.userId));

    return {
      patients: rows.map((row) => ({
        id: row.id,
        email: row.email,
        name: row.name,
        boundAt: row.boundAt,
      })),
    };
  });
};
