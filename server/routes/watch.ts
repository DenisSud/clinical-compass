import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { watchCreateSchema } from "../../shared/contracts.js";
import { instrument } from "../instruments/loader.js";
import { requireAuth, requireRole } from "../auth/guard.js";
import { watchItems } from "../db/schema.js";
import { fail, forbidden, notFound } from "../http/errors.js";
import { loadPatientForDoctor } from "../patient-access.js";
import { hasComparableTotal, toWatchItem } from "../watch-service.js";

/** Всё, кроме подписи, уходит в params; подпись живёт в своих колонках. */
function paramsOf(input: { kind: string } & Record<string, unknown>): Record<string, unknown> {
  const { kind: _kind, title: _title, severity: _severity, ...rest } = input;
  return rest;
}

export const watchRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { id: string } }>(
    "/patients/:id/watch",
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
        .from(watchItems)
        .where(eq(watchItems.patientId, lookup.patient.id))
        .orderBy(asc(watchItems.createdAt));

      // Правило порога по шкале без суммы не показывается как активное: оно не сработает
      // ни разу и только обещало бы врачу наблюдение, которого нет (SPEC S10).
      return { items: rows.map(toWatchItem).filter(hasComparableTotal) };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/patients/:id/watch",
    { preHandler: requireRole("doctor") },
    async (request, reply) => {
      const lookup = await loadPatientForDoctor(app, requireAuth(request).userId, request.params.id);
      if (!lookup.ok) {
        return lookup.status === 404
          ? notFound(reply, "Пациент не найден")
          : forbidden(reply, "Этого пациента ведёт другой врач");
      }

      const parsed = watchCreateSchema.safeParse(request.body);
      if (!parsed.success) {
        return fail(reply, 400, "invalid_request", "Проверьте параметры правила");
      }

      // Правило на несуществующую шкалу не сработает никогда: лучше отказать на создании,
      // чем оставить врача с правилом, которое молчит (issue #68).
      if (parsed.data.kind === "score_threshold") {
        const scale = instrument(parsed.data.instrumentId);
        if (!scale) return fail(reply, 400, "invalid_request", "Нет такой шкалы");

        // У шкалы без общей суммы порога нет: правило сравнивало бы выдуманное число.
        if (scale.scoring === "items") {
          return fail(
            reply,
            400,
            "invalid_request",
            `У шкалы «${scale.shortTitle ?? scale.title}» нет общей суммы`,
          );
        }
      }

      const [row] = await app.conn.db
        .insert(watchItems)
        .values({
          id: randomUUID(),
          patientId: lookup.patient.id,
          doctorId: requireAuth(request).userId,
          kind: parsed.data.kind,
          title: parsed.data.title,
          severity: parsed.data.severity,
          params: JSON.stringify(paramsOf(parsed.data)),
          status: "active",
          createdAt: new Date().toISOString(),
        })
        .returning();

      return reply.code(201).send({ item: toWatchItem(row!) });
    },
  );

  for (const action of ["pause", "resume"] as const) {
    app.post<{ Params: { id: string } }>(
      `/watch/:id/${action}`,
      { preHandler: requireRole("doctor") },
      async (request, reply) => {
        const [row] = await app.conn.db
          .select()
          .from(watchItems)
          .where(eq(watchItems.id, request.params.id))
          .limit(1);

        if (!row) return notFound(reply, "Правило не найдено");

        const lookup = await loadPatientForDoctor(app, requireAuth(request).userId, row.patientId);
        if (!lookup.ok) return forbidden(reply, "Этого пациента ведёт другой врач");

        const wanted = action === "pause" ? "paused" : "active";
        if (row.status === wanted) {
          return fail(reply, 409, "wrong_status", "Правило уже в этом состоянии");
        }

        const [updated] = await app.conn.db
          .update(watchItems)
          .set({
            status: wanted,
            pausedAt: action === "pause" ? new Date().toISOString() : null,
          })
          .where(eq(watchItems.id, row.id))
          .returning();

        return { item: toWatchItem(updated!) };
      },
    );
  }
};
