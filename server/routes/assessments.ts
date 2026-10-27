import { randomUUID } from "node:crypto";
import { and, desc, eq, lt } from "drizzle-orm";
import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import {
  assessmentSubmitSchema,
  instrumentListResponseSchema,
  instrumentViewSchema,
  type DoctorAssessment,
  type PatientAssessment,
} from "../../shared/contracts.js";
import { requireAuth, requireRole } from "../auth/guard.js";
import { assessments } from "../db/schema.js";
import { InvalidAnswers, criticalItems, score } from "../instruments/engine.js";
import {
  instrument as findInstrument,
  patientInstrument,
  patientInstruments,
  repeatAfterHours,
} from "../instruments/loader.js";
import { runDecisionQuestions } from "../decisions/service.js";
import { statusOf } from "../patient-status.js";
import type { Instrument } from "../instruments/schema.js";
import { fail, forbidden, notFound } from "../http/errors.js";
import { loadPatientForDoctor } from "../patient-access.js";
import { signalsForAssessment } from "../rules/signals.js";
import { raiseWatchSignals } from "../watch-service.js";
import { saveSignals } from "./signals.js";

/**
 * The interval belongs to the assignment, not to the route: the status file says how
 * often a questionnaire opens for this patient (monthly PHQ-9 in treatment, weekly
 * when the doctor marks worsening), and ASQ is not locked at all. A suicide-risk
 * screener that answers «спросите через неделю» is a safety problem, not a rate limit.
 */
const HOUR_MS = 60 * 60 * 1000;

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

/** The questionnaire is weekly: the next attempt opens seven days after the last one. */
async function nextAttemptAt(
  app: Parameters<FastifyPluginAsync>[0],
  patientId: string,
  instrument: Instrument,
  repeatHours: number,
): Promise<string | null> {
  const instrumentId = instrument.id;
  if (repeatHours === 0) return null;
  const [last] = await app.conn.db
    .select({ submittedAt: assessments.submittedAt })
    .from(assessments)
    .where(and(eq(assessments.patientId, patientId), eq(assessments.instrumentId, instrumentId)))
    .orderBy(desc(assessments.submittedAt))
    .limit(1);

  if (!last) return null;

  const opensAt = new Date(last.submittedAt).getTime() + repeatHours * HOUR_MS;
  return opensAt > Date.now() ? new Date(opensAt).toISOString() : null;
}

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

/**
 * Derives and stores the signals for one submission. Conflict-safe, so the retry
 * path calls it too: otherwise a first attempt that died before writing the signals
 * would leave a stored questionnaire with a critical answer and no signal.
 */
async function deriveAssessmentSignals(
  app: FastifyInstance,
  input: {
    patientId: string;
    instrument: Instrument;
    answers: Record<string, number>;
    total: number;
    submittedAt: string;
    sourceId: string;
  },
): Promise<void> {
  const [previous] = await app.conn.db
    .select({
      instrumentId: assessments.instrumentId,
      instrumentVersion: assessments.instrumentVersion,
      totalScore: assessments.totalScore,
    })
    .from(assessments)
    .where(
      and(
        eq(assessments.patientId, input.patientId),
        // Прошлая отправка той же шкалы: сумма другой шкалы — не динамика пациента
        // (decisions.md §4). Версию сверяет реестр — смена версии меняет смысл суммы.
        eq(assessments.instrumentId, input.instrument.id),
        lt(assessments.submittedAt, input.submittedAt),
      ),
    )
    .orderBy(desc(assessments.submittedAt))
    .limit(1);

  await raiseWatchSignals(app, {
    patientId: input.patientId,
    sourceType: "assessment",
    sourceId: input.sourceId,
    event: { type: "assessment", instrumentId: input.instrument.id, total: input.total },
  });

  await runDecisionQuestions(app, {
    patientId: input.patientId,
    sourceType: "assessment",
    sourceId: input.sourceId,
  });

  await saveSignals(app, {
    patientId: input.patientId,
    sourceType: "assessment",
    sourceId: input.sourceId,
    drafts: signalsForAssessment({
      instrument: input.instrument,
      answers: input.answers,
      total: input.total,
      previous: previous
        ? {
            instrumentId: previous.instrumentId,
            instrumentVersion: previous.instrumentVersion,
            total: previous.totalScore,
          }
        : null,
    }),
  });
}

/** A stored answer whose instrument description is gone still belongs in the history. */
function degradedPatientAssessment(row: typeof assessments.$inferSelect): PatientAssessment {
  const answers = JSON.parse(row.answers) as Record<string, number>;
  return {
    id: row.id,
    instrumentId: row.instrumentId,
    instrumentTitle: `«${row.instrumentId}» — описание опросника недоступно`,
    submittedAt: row.submittedAt,
    answers: Object.entries(answers).map(([itemId, value]) => ({
      itemId,
      text: itemId,
      value,
      label: String(value),
    })),
  };
}

function degradedDoctorAssessment(row: typeof assessments.$inferSelect): DoctorAssessment {
  return {
    id: row.id,
    instrumentId: row.instrumentId,
    instrumentTitle: `«${row.instrumentId}» — описание опросника недоступно`,
    submittedAt: row.submittedAt,
    total: row.totalScore,
    band: { id: row.bandId, label: row.bandLabel },
    criticalItems: [],
    instrumentMissing: true,
  };
}

/** The patient's view: no bands, no critical flags, no score. The status itself never leaves here. */
function toInstrumentView(instrument: Instrument) {
  return instrumentViewSchema.parse({
    id: instrument.id,
    title: instrument.title,
    intro: instrument.intro,
    options: instrument.options,
    items: instrument.items.map((item) => ({ id: item.id, text: item.text })),
    sourceNote: instrument.source.note,
  });
}

export const assessmentRoutes: FastifyPluginAsync = async (app) => {
  /**
   * What this patient may fill in, in the order the status file lists. A patient
   * with no questionnaires sees an empty list, not every questionnaire in the
   * registry: the doctor decides the set, not the patient (issue #68).
   */
  app.get("/instruments", { preHandler: requireRole("patient") }, async (request) => {
    const status = await statusOf(app, requireAuth(request).userId);

    return instrumentListResponseSchema.parse({
      instruments: patientInstruments(status).map(toInstrumentView),
    });
  });

  app.get<{ Params: { id: string } }>(
    "/instruments/:id",
    { preHandler: requireRole("patient") },
    async (request, reply) => {
      const status = await statusOf(app, requireAuth(request).userId);
      const instrument = patientInstrument(status, request.params.id);
      if (!instrument) return notFound(reply, "Опросник не найден");

      return { instrument: toInstrumentView(instrument) };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/assessments/:id",
    { preHandler: requireRole("patient") },
    async (request, reply) => {
      const patientId = requireAuth(request).userId;
      const status = await statusOf(app, patientId);
      const instrument = patientInstrument(status, request.params.id);
      if (!instrument) return notFound(reply, "Опросник не найден");

      const parsed = assessmentSubmitSchema.safeParse(request.body);
      if (!parsed.success) return fail(reply, 400, "invalid_request", "Проверьте ответы");

      const [existing] = await app.conn.db
        .select()
        .from(assessments)
        .where(
          and(
            eq(assessments.patientId, patientId),
            eq(assessments.submissionId, parsed.data.submissionId),
          ),
        )
        .limit(1);
      if (existing) {
        if (existing.instrumentId !== instrument.id) {
          return fail(
            reply,
            409,
            "wrong_instrument",
            "Этот идентификатор отправки уже использован для другого опросника",
          );
        }
        // First result wins, and the signals it deserves are repaired if missing.
        await deriveAssessmentSignals(app, {
          patientId,
          instrument,
          answers: JSON.parse(existing.answers) as Record<string, number>,
          total: existing.totalScore,
          submittedAt: existing.submittedAt,
          sourceId: existing.id,
        });
        return reply.code(200).send({ assessment: toPatientAssessment(instrument, existing) });
      }

      const nextAllowedAt = await nextAttemptAt(
        app,
        patientId,
        instrument,
        repeatAfterHours(status, instrument.id) ?? instrument.repeatAfterHours,
      );
      if (nextAllowedAt && Date.now() < new Date(nextAllowedAt).getTime()) {
        return fail(
          reply,
          409,
          "too_soon",
          `Этот опросник проходят не чаще раза в неделю. Следующий раз — ${formatDay(nextAllowedAt)}`,
        );
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

      await deriveAssessmentSignals(app, {
        patientId,
        instrument,
        answers: parsed.data.answers,
        total: scored.total,
        submittedAt,
        sourceId: row.id,
      });

      return reply.code(201).send({ assessment: toPatientAssessment(instrument, row) });
    },
  );

  app.get("/assessments", { preHandler: requireRole("patient") }, async (request) => {
    const rows = await app.conn.db
      .select()
      .from(assessments)
      .where(eq(assessments.patientId, requireAuth(request).userId))
      .orderBy(desc(assessments.submittedAt));

    const lastInstrument = rows[0] ? findInstrument(rows[0].instrumentId) : undefined;
    const status = await statusOf(app, requireAuth(request).userId);

    return {
      assessments: rows.map((row) => {
        const instrument = findInstrument(row.instrumentId);
        return instrument ? toPatientAssessment(instrument, row) : degradedPatientAssessment(row);
      }),
      nextAllowedAt: lastInstrument
        ? await nextAttemptAt(
            app,
            requireAuth(request).userId,
            lastInstrument,
            repeatAfterHours(status, lastInstrument.id) ?? lastInstrument.repeatAfterHours,
          )
        : null,
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
        assessments: rows.map((row) => {
          const instrument = findInstrument(row.instrumentId);
          return instrument ? toDoctorAssessment(instrument, row) : degradedDoctorAssessment(row);
        }),
      };
    },
  );
};
