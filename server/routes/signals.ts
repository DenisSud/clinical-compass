import { randomUUID } from "node:crypto";
import { desc, eq, inArray } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { signalCloseSchema, type Signal } from "../../shared/contracts.js";
import { requireAuth, requireRole } from "../auth/guard.js";
import { patients, signals } from "../db/schema.js";
import { fail, forbidden, notFound } from "../http/errors.js";
import { loadPatientForDoctor } from "../patient-access.js";
import type { SignalDraft } from "../rules/signals.js";

export function toSignal(row: typeof signals.$inferSelect): Signal {
  return {
    id: row.id,
    patientId: row.patientId,
    kind: row.kind,
    severity: row.severity as Signal["severity"],
    title: row.title,
    detail: row.detail,
    status: row.status as Signal["status"],
    outcome: row.outcome,
    createdAt: row.createdAt,
    takenAt: row.takenAt,
    closedAt: row.closedAt,
    watchItemId: row.watchItemId === "" ? null : row.watchItemId,
  };
}

/** Writes signals for a submission. The unique index makes a retry a no-op. */
export async function saveSignals(
  app: Parameters<FastifyPluginAsync>[0],
  input: {
    patientId: string;
    sourceType: "assessment" | "diary" | "checkin" | "message" | "dose";
    sourceId: string;
    drafts: (SignalDraft & { watchItemId?: string })[];
  },
): Promise<void> {
  if (input.drafts.length === 0) return;

  const createdAt = new Date().toISOString();
  for (const draft of input.drafts) {
    await app.conn.db
      .insert(signals)
      .values({
        id: randomUUID(),
        patientId: input.patientId,
        kind: draft.kind,
        severity: draft.severity,
        title: draft.title,
        detail: draft.detail,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        status: "saved",
        watchItemId: draft.watchItemId ?? "",
        createdAt,
      })
      .onConflictDoNothing();
  }
}

export const signalRoutes: FastifyPluginAsync = async (app) => {
  app.get("/signals", { preHandler: requireRole("doctor") }, async (request) => {
    const doctorId = requireAuth(request).userId;
    const mine = await app.conn.db
      .select({ id: patients.id, email: patients.email, name: patients.name })
      .from(patients)
      .where(eq(patients.doctorId, doctorId));

    if (mine.length === 0) return { signals: [] };

    const rows = await app.conn.db
      .select()
      .from(signals)
      .where(inArray(signals.patientId, mine.map((patient) => patient.id)))
      .orderBy(desc(signals.createdAt));

    const byId = new Map(mine.map((patient) => [patient.id, patient]));
    return {
      signals: rows.map((row) => ({
        ...toSignal(row),
        patient: byId.get(row.patientId) ?? null,
      })),
    };
  });

  app.post<{ Params: { id: string } }>(
    "/signals/:id/take",
    { preHandler: requireRole("doctor") },
    async (request, reply) => {
      const signal = await loadOwnSignal(app, requireAuth(request).userId, request.params.id);
      if (!signal.ok) return signal.reply(reply);
      if (signal.row.status === "closed") {
        return fail(reply, 409, "wrong_status", "Сигнал уже закрыт");
      }
      if (signal.row.status !== "saved") {
        return fail(reply, 409, "wrong_status", "Сигнал уже взят в разбор");
      }

      const takenAt = new Date().toISOString();
      const [updated] = await app.conn.db
        .update(signals)
        .set({ status: "in_review", takenAt })
        .where(eq(signals.id, signal.row.id))
        .returning();

      return { signal: toSignal(updated!) };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/signals/:id/close",
    { preHandler: requireRole("doctor") },
    async (request, reply) => {
      const signal = await loadOwnSignal(app, requireAuth(request).userId, request.params.id);
      if (!signal.ok) return signal.reply(reply);

      const parsed = signalCloseSchema.safeParse(request.body);
      if (!parsed.success) return fail(reply, 400, "invalid_request", "Опишите результат разбора");
      if (signal.row.status === "closed") {
        return fail(reply, 409, "wrong_status", "Сигнал уже закрыт");
      }
      // saved -> closed would leave a closed signal nobody ever took into review.
      if (signal.row.status === "saved") {
        return fail(reply, 409, "wrong_status", "Сначала возьмите сигнал в разбор");
      }

      const closedAt = new Date().toISOString();
      const [updated] = await app.conn.db
        .update(signals)
        .set({ status: "closed", outcome: parsed.data.outcome, closedAt })
        .where(eq(signals.id, signal.row.id))
        .returning();

      return { signal: toSignal(updated!) };
    },
  );

  app.get<{ Params: { id: string } }>(
    "/patients/:id/signals",
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
        .from(signals)
        .where(eq(signals.patientId, lookup.patient.id))
        .orderBy(desc(signals.createdAt));

      return { signals: rows.map(toSignal) };
    },
  );
};

type OwnSignal =
  | { ok: true; row: typeof signals.$inferSelect }
  | { ok: false; reply: (reply: import("fastify").FastifyReply) => unknown };

async function loadOwnSignal(
  app: Parameters<FastifyPluginAsync>[0],
  doctorId: string,
  signalId: string,
): Promise<OwnSignal> {
  const [row] = await app.conn.db.select().from(signals).where(eq(signals.id, signalId)).limit(1);
  if (!row) return { ok: false, reply: (reply) => notFound(reply, "Сигнал не найден") };

  const lookup = await loadPatientForDoctor(app, doctorId, row.patientId);
  if (!lookup.ok) {
    return {
      ok: false,
      reply: (reply) =>
        lookup.status === 404
          ? notFound(reply, "Пациент не найден")
          : forbidden(reply, "Этот сигнал относится к пациенту другого врача"),
    };
  }

  return { ok: true, row };
}
