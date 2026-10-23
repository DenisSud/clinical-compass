import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { diarySubmitSchema, type DiaryEntry } from "../../shared/contracts.js";
import { requireAuth, requireRole } from "../auth/guard.js";
import { diaryEntries } from "../db/schema.js";
import { fail, forbidden, notFound } from "../http/errors.js";
import { loadPatientForDoctor } from "../patient-access.js";

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
    const [existing] = await app.conn.db
      .select()
      .from(diaryEntries)
      .where(eq(diaryEntries.submissionId, parsed.data.submissionId))
      .limit(1);
    if (existing && existing.patientId === patientId) {
      return reply.code(200).send({ entry: toEntry(existing) });
    }

    const createdAt = new Date().toISOString();
    const [row] = await app.conn.db
      .insert(diaryEntries)
      .values({
        id: randomUUID(),
        patientId,
        entryDate: parsed.data.entryDate ?? createdAt.slice(0, 10),
        value: parsed.data.value,
        comment: parsed.data.comment ?? null,
        submissionId: parsed.data.submissionId,
        createdAt,
      })
      .returning();
    if (!row) throw new Error("insert returned no row");

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
