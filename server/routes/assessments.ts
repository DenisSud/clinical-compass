import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import {
  assessmentSubmitSchema,
  instrumentViewSchema,
  type DoctorAssessment,
  type PatientAssessment,
} from "../../shared/contracts.js";
import { requireAuth, requireRole } from "../auth/guard.js";
import { assessments } from "../db/schema.js";
import { InvalidAnswers, criticalItems, score } from "../instruments/engine.js";
import { instrument as findInstrument } from "../instruments/loader.js";
import type { Instrument } from "../instruments/schema.js";
import { fail, forbidden, notFound } from "../http/errors.js";
import { loadPatientForDoctor } from "../patient-access.js";

function answerList(instrument: Instrument, answers: Record<string, number>) {
  return instrument.items.map((item) => ({
    itemId: item.id,
    text: item.text,
    value: answers[item.id] ?? 0,
    label: instrument.options.find((option) => option.value === answers[item.id])?.label ?? "",
  }));
}

/** What the patient sees: their own answers, without a score or a band. */
function toPatientAssessment(
  instrument: Instrument,
  row: typeof assessments.$inferSelect,
): PatientAssessment {
  return {
    id: row.id,
    instrumentId: row.instrumentId,
    instrumentTitle: instrument.title,
    submittedAt: row.submittedAt,
    answers: answerList(instrument, JSON.parse(row.answers) as Record<string, number>),
  };
}

/** What the doctor sees: the same answers plus the score and its band. */
function toDoctorAssessment(
  instrument: Instrument,
  row: typeof assessments.$inferSelect,
): DoctorAssessment {
  return {
    id: row.id,
    instrumentId: row.instrumentId,
    instrumentTitle: instrument.title,
    submittedAt: row.submittedAt,
    total: row.totalScore,
    band: { id: row.bandId, label: row.bandLabel },
    criticalItems: criticalItems(instrument, JSON.parse(row.answers) as Record<string, number>),
  };
}

export const assessmentRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { id: string } }>(
    "/instruments/:id",
    { preHandler: requireRole("patient") },
    async (request, reply) => {
      const instrument = findInstrument(request.params.id);
      if (!instrument) return notFound(reply, "Опросник не найден");

      return {
        instrument: instrumentViewSchema.parse({
          id: instrument.id,
          title: instrument.title,
          intro: instrument.intro,
          options: instrument.options,
          items: instrument.items.map((item) => ({ id: item.id, text: item.text })),
          sourceNote: instrument.source.note,
        }),
      };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/assessments/:id",
    { preHandler: requireRole("patient") },
    async (request, reply) => {
      const instrument = findInstrument(request.params.id);
      if (!instrument) return notFound(reply, "Опросник не найден");

      const parsed = assessmentSubmitSchema.safeParse(request.body);
      if (!parsed.success) return fail(reply, 400, "invalid_request", "Проверьте ответы");

      const patientId = requireAuth(request).userId;
      const [existing] = await app.conn.db
        .select()
        .from(assessments)
        .where(eq(assessments.submissionId, parsed.data.submissionId))
        .limit(1);
      if (existing && existing.patientId === patientId) {
        return reply.code(200).send({ assessment: toPatientAssessment(instrument, existing) });
      }

      let scored;
      try {
        scored = score(instrument, parsed.data.answers);
      } catch (error) {
        if (error instanceof InvalidAnswers) {
          return fail(reply, 400, "invalid_request", "Ответьте на все пункты");
        }
        throw error;
      }

      const submittedAt = new Date().toISOString();
      const [row] = await app.conn.db
        .insert(assessments)
        .values({
          id: randomUUID(),
          patientId,
          instrumentId: instrument.id,
          instrumentVersion: instrument.version,
          answers: JSON.stringify(parsed.data.answers),
          totalScore: scored.total,
          bandId: scored.band.id,
          bandLabel: scored.band.label,
          submissionId: parsed.data.submissionId,
          submittedAt,
          createdAt: submittedAt,
        })
        .returning();
      if (!row) throw new Error("insert returned no row");

      return reply.code(201).send({ assessment: toPatientAssessment(instrument, row) });
    },
  );

  app.get("/assessments", { preHandler: requireRole("patient") }, async (request) => {
    const rows = await app.conn.db
      .select()
      .from(assessments)
      .where(eq(assessments.patientId, requireAuth(request).userId))
      .orderBy(desc(assessments.submittedAt));

    return {
      assessments: rows.flatMap((row) => {
        const instrument = findInstrument(row.instrumentId);
        return instrument ? [toPatientAssessment(instrument, row)] : [];
      }),
    };
  });

  app.get<{ Params: { id: string } }>(
    "/patients/:id/assessments",
    { preHandler: requireRole("doctor") },
    async (request, reply) => {
      const lookup = await loadPatientForDoctor(app, requireAuth(request).userId, request.params.id);
      if (!lookup.ok) {
        return lookup.status === 404
          ? notFound(reply, "Пациент не найден")
          : forbidden(reply, "Этого пациента ведёт другой врач");
      }

      const rows = await app.conn.db
        .select()
        .from(assessments)
        .where(eq(assessments.patientId, lookup.patient.id))
        .orderBy(desc(assessments.submittedAt));

      return {
        assessments: rows.flatMap((row) => {
          const instrument = findInstrument(row.instrumentId);
          return instrument ? [toDoctorAssessment(instrument, row)] : [];
        }),
      };
    },
  );
};
