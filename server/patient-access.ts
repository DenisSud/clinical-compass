import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { patients } from "./db/schema.js";

export type PatientRow = typeof patients.$inferSelect;

export type PatientLookup =
  | { ok: true; patient: PatientRow }
  | { ok: false; status: 404 | 403 };

/** Врач может дойти только до своих пациентов; два отказа остаются разными. */
export async function loadPatientForDoctor(
  app: FastifyInstance,
  doctorId: string,
  patientId: string,
): Promise<PatientLookup> {
  const [patient] = await app.conn.db.select().from(patients).where(eq(patients.id, patientId)).limit(1);

  if (!patient) return { ok: false, status: 404 };
  if (patient.doctorId !== doctorId) return { ok: false, status: 403 };
  return { ok: true, patient };
}
