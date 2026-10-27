import { randomUUID } from "node:crypto";
import { and, desc, eq, lt } from "drizzle-orm";
import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { diarySubmitSchema, type DiaryEntry } from "../../shared/contracts.js";
import { requireAuth, requireRole } from "../auth/guard.js";
import { diaryEntries } from "../db/schema.js";
import { fail, forbidden, notFound } from "../http/errors.js";
import { loadPatientForDoctor } from "../patient-access.js";
import { runDecisionQuestions } from "../decisions/service.js";
import { signalsForDiary } from "../rules/signals.js";
import { raiseWatchSignals } from "../watch-service.js";
import { saveSignals } from "./signals.js";

/**
 * Derives and stores the signals for one entry. Conflict-safe, so calling it again
 * on a retry repairs a first attempt that died between the insert and the signals.
 */
async function deriveDiarySignals(
  app: FastifyInstance,
  patientId: string,
  row: typeof diaryEntries.$inferSelect,
): Promise<void> {
  const [previous] = await app.conn.db
    .select({ value: diaryEntries.value })
    .from(diaryEntries)
    .where(and(eq(diaryEntries.patientId, patientId), lt(diaryEntries.entryDate, row.entryDate)))
    .orderBy(desc(diaryEntries.entryDate), desc(diaryEntries.createdAt))
    .limit(1);
  const previousValue = previous?.value ?? null;

  await saveSignals(app, {
    patientId,
    sourceType: "diary",
    sourceId: row.id,
    drafts: signalsForDiary({ value: row.value, previousValue }),
  });

  await runDecisionQuestions(app, { patientId, sourceType: "diary", sourceId: row.id });

  await raiseWatchSignals(app, {
    patientId,
    sourceType: "diary",
    sourceId: row.id,
    event: { type: "diary", value: row.value, previousValue },
  });
}

function toEntry(row: typeof diaryEntries.$inferSelect): DiaryEntry {
  return {
    id: row.id,
    entryDate: row.entryDate,
    value: row.value,
    comment: row.comment,
    createdAt: row.createdAt,
  };
}

export const diaryRoutes: FastifyPluginAsync = async (app) => {
  app.post("/diary", { preHandler: requireRole("patient") }, async (request, reply) => {
    const parsed = diarySubmitSchema.safeParse(request.body);
    if (!parsed.success) return fail(reply, 400, "invalid_request", "Оценка — от 1 до 10");

    const patientId = requireAuth(request).userId;
    // Scoped to this patient: the unique index is (patient_id, submission_id), so two
    // patients may hold the same id and an unscoped lookup could miss the caller's row.
    const [existing] = await app.conn.db
      .select()
      .from(diaryEntries)
      .where(
        and(
          eq(diaryEntries.patientId, patientId),
          eq(diaryEntries.submissionId, parsed.data.submissionId),
        ),
      )
      .limit(1);
    if (existing) {
      await deriveDiarySignals(app, patientId, existing);
      return reply.code(200).send({ entry: toEntry(existing) });
    }

    const createdAt = new Date().toISOString();
    const entryDate = parsed.data.entryDate ?? createdAt.slice(0, 10);

    // The patient's own date wins over the server's, but only by a day either way.
    const skewDays = Math.abs(Date.parse(entryDate) - Date.parse(createdAt.slice(0, 10))) / 86_400_000;
    if (Number.isNaN(skewDays) || skewDays > 1) {
      return fail(reply, 400, "invalid_request", "Дата записи вне допустимого диапазона");
    }

    const [sameDay] = await app.conn.db
      .select()
      .from(diaryEntries)
      .where(and(eq(diaryEntries.patientId, patientId), eq(diaryEntries.entryDate, entryDate)))
      .limit(1);
    if (sameDay) {
      return fail(
        reply,
        409,
        "already_recorded",
        "На этот день запись уже есть. Одна запись в день — так динамика остаётся честной",
      );
    }

    const [row] = await app.conn.db
      .insert(diaryEntries)
      .values({
        id: randomUUID(),
        patientId,
        entryDate,
        value: parsed.data.value,
        comment: parsed.data.comment ?? null,
        submissionId: parsed.data.submissionId,
        createdAt,
      })
      .returning();
    if (!row) throw new Error("insert returned no row");

    await deriveDiarySignals(app, patientId, row);

    return reply.code(201).send({ entry: toEntry(row) });
  });

  app.get("/diary", { preHandler: requireRole("patient") }, async (request) => {
    const rows = await app.conn.db
      .select()
      .from(diaryEntries)
      .where(eq(diaryEntries.patientId, requireAuth(request).userId))
      .orderBy(desc(diaryEntries.entryDate), desc(diaryEntries.createdAt));

    return { entries: rows.map(toEntry) };
  });

  app.get<{ Params: { id: string } }>(
    "/patients/:id/diary",
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
        .from(diaryEntries)
        .where(eq(diaryEntries.patientId, lookup.patient.id))
        .orderBy(desc(diaryEntries.entryDate), desc(diaryEntries.createdAt));

      return { entries: rows.map(toEntry) };
    },
  );
};
