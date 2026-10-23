import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { messageCreateSchema, type Message } from "../../shared/contracts.js";
import { requireAuth, requireRole } from "../auth/guard.js";
import { messages } from "../db/schema.js";
import { fail, forbidden, notFound } from "../http/errors.js";
import { loadPatientForDoctor } from "../patient-access.js";
import { raiseWatchSignals } from "../watch-service.js";

function toMessage(row: typeof messages.$inferSelect): Message {
  return {
    id: row.id,
    patientId: row.patientId,
    authorRole: row.authorRole as Message["authorRole"],
    body: row.body,
    createdAt: row.createdAt,
  };
}

export const messageRoutes: FastifyPluginAsync = async (app) => {
  app.get("/messages", { preHandler: requireRole("patient") }, async (request) => {
    const rows = await app.conn.db
      .select()
      .from(messages)
      .where(eq(messages.patientId, requireAuth(request).userId))
      .orderBy(asc(messages.createdAt));

    return { messages: rows.map(toMessage) };
  });

  app.post("/messages", { preHandler: requireRole("patient") }, async (request, reply) => {
    const parsed = messageCreateSchema.safeParse(request.body);
    if (!parsed.success) return fail(reply, 400, "invalid_request", "Напишите сообщение");

    const [row] = await app.conn.db
      .insert(messages)
      .values({
        id: randomUUID(),
        patientId: requireAuth(request).userId,
        authorRole: "patient",
        body: parsed.data.body,
        createdAt: new Date().toISOString(),
      })
      .returning();
    if (!row) throw new Error("insert returned no row");

    await raiseWatchSignals(app, {
      patientId: row.patientId,
      sourceType: "message",
      sourceId: row.id,
      event: { type: "message", text: row.body },
    });

    return reply.code(201).send({ message: toMessage(row) });
  });

  app.get<{ Params: { id: string } }>(
    "/patients/:id/messages",
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
        .from(messages)
        .where(eq(messages.patientId, lookup.patient.id))
        .orderBy(asc(messages.createdAt));

      return { messages: rows.map(toMessage) };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/patients/:id/messages",
    { preHandler: requireRole("doctor") },
    async (request, reply) => {
      const lookup = await loadPatientForDoctor(app, requireAuth(request).userId, request.params.id);
      if (!lookup.ok) {
        return lookup.status === 404
          ? notFound(reply, "Пациент не найден")
          : forbidden(reply, "Этого пациента ведёт другой врач");
      }

      const parsed = messageCreateSchema.safeParse(request.body);
      if (!parsed.success) return fail(reply, 400, "invalid_request", "Напишите сообщение");

      const [row] = await app.conn.db
        .insert(messages)
        .values({
          id: randomUUID(),
          patientId: lookup.patient.id,
          authorRole: "doctor",
          body: parsed.data.body,
          createdAt: new Date().toISOString(),
        })
        .returning();
      if (!row) throw new Error("insert returned no row");

      return reply.code(201).send({ message: toMessage(row) });
    },
  );
};
