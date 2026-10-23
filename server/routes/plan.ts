import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { planItemCreateSchema, type PlanItem } from "../../shared/contracts.js";
import { requireAuth, requireRole } from "../auth/guard.js";
import { planItems } from "../db/schema.js";
import { fail, forbidden, notFound } from "../http/errors.js";
import { loadPatientForDoctor } from "../patient-access.js";

export function toPlanItem(row: typeof planItems.$inferSelect): PlanItem {
  return {
    id: row.id,
    patientId: row.patientId,
    kind: row.kind as PlanItem["kind"],
    title: row.title,
    details: row.details,
    status: row.status as PlanItem["status"],
    createdAt: row.createdAt,
    confirmedAt: row.confirmedAt,
    archivedAt: row.archivedAt,
  };
}

export const planRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { id: string } }>(
    "/patients/:id/plan",
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
        .from(planItems)
        .where(eq(planItems.patientId, lookup.patient.id))
        .orderBy(desc(planItems.createdAt));

      return { items: rows.map(toPlanItem) };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/patients/:id/plan",
    { preHandler: requireRole("doctor") },
    async (request, reply) => {
      const lookup = await loadPatientForDoctor(app, requireAuth(request).userId, request.params.id);
      if (!lookup.ok) {
        return lookup.status === 404
          ? notFound(reply, "Пациент не найден")
          : forbidden(reply, "Этого пациента ведёт другой врач");
      }

      const parsed = planItemCreateSchema.safeParse(request.body);
      if (!parsed.success) return fail(reply, 400, "invalid_request", "Заполните название пункта");

      const [row] = await app.conn.db
        .insert(planItems)
        .values({
          id: randomUUID(),
          patientId: lookup.patient.id,
          kind: parsed.data.kind,
          title: parsed.data.title,
          details: parsed.data.details ?? null,
          status: "draft",
          createdAt: new Date().toISOString(),
        })
        .returning();
      if (!row) throw new Error("insert returned no row");

      return reply.code(201).send({ item: toPlanItem(row) });
    },
  );

  app.post<{ Params: { id: string } }>(
    "/plan/:id/confirm",
    { preHandler: requireRole("doctor") },
    async (request, reply) => {
      const found = await loadOwnItem(app, requireAuth(request).userId, request.params.id);
      if (!found.ok) return found.reply(reply);
      if (found.row.status !== "draft") {
        return fail(reply, 409, "wrong_status", "Пункт уже подтверждён");
      }

      const [row] = await app.conn.db
        .update(planItems)
        .set({ status: "active", confirmedAt: new Date().toISOString() })
        .where(eq(planItems.id, found.row.id))
        .returning();

      return { item: toPlanItem(row!) };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/plan/:id/archive",
    { preHandler: requireRole("doctor") },
    async (request, reply) => {
      const found = await loadOwnItem(app, requireAuth(request).userId, request.params.id);
      if (!found.ok) return found.reply(reply);

      const [row] = await app.conn.db
        .update(planItems)
        .set({ status: "archived", archivedAt: new Date().toISOString() })
        .where(eq(planItems.id, found.row.id))
        .returning();

      return { item: toPlanItem(row!) };
    },
  );

  app.get("/plan", { preHandler: requireRole("patient") }, async (request) => {
    const rows = await app.conn.db
      .select()
      .from(planItems)
      .where(
        and(eq(planItems.patientId, requireAuth(request).userId), eq(planItems.status, "active")),
      )
      .orderBy(desc(planItems.confirmedAt));

    return { items: rows.map(toPlanItem) };
  });
};

type OwnItem =
  | { ok: true; row: typeof planItems.$inferSelect }
  | { ok: false; reply: (reply: import("fastify").FastifyReply) => unknown };

async function loadOwnItem(
  app: Parameters<FastifyPluginAsync>[0],
  doctorId: string,
  itemId: string,
): Promise<OwnItem> {
  const [row] = await app.conn.db.select().from(planItems).where(eq(planItems.id, itemId)).limit(1);
  if (!row) return { ok: false, reply: (reply) => notFound(reply, "Пункт плана не найден") };

  const lookup = await loadPatientForDoctor(app, doctorId, row.patientId);
  if (!lookup.ok) {
    return {
      ok: false,
      reply: (reply) =>
        lookup.status === 404
          ? notFound(reply, "Пациент не найден")
          : forbidden(reply, "Этот план относится к пациенту другого врача"),
    };
  }

  return { ok: true, row };
}
