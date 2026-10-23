import { randomUUID } from "node:crypto";
import { and, asc, eq, gte } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import {
  checkinSubmitSchema,
  type AdherenceDay,
  type AdherenceItem,
  type PatientCheckinItem,
} from "../../shared/contracts.js";
import { requireAuth, requireRole } from "../auth/guard.js";
import { planCheckins, planItems } from "../db/schema.js";
import { fail, forbidden, notFound } from "../http/errors.js";
import { loadPatientForDoctor } from "../patient-access.js";

const MAX_WINDOW_DAYS = 60;
const DEFAULT_WINDOW_DAYS = 14;
const REASON_MIN_LENGTH = 3;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function shiftDate(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

/** Inclusive list of dates from `from` to `to`. */
function dateRange(from: string, to: string): string[] {
  const dates: string[] = [];
  for (let date = from; date <= to; date = shiftDate(date, 1)) dates.push(date);
  return dates;
}

export const checkinRoutes: FastifyPluginAsync = async (app) => {
  app.get("/checkins", { preHandler: requireRole("patient") }, async (request) => {
    const patientId = requireAuth(request).userId;
    const day = today();

    const items = await app.conn.db
      .select()
      .from(planItems)
      .where(and(eq(planItems.patientId, patientId), eq(planItems.status, "active")))
      .orderBy(asc(planItems.confirmedAt));

    const recorded = await app.conn.db
      .select()
      .from(planCheckins)
      .where(and(eq(planCheckins.patientId, patientId), eq(planCheckins.checkinDate, day)));

    const byItem = new Map(recorded.map((row) => [row.planItemId, row]));

    const result: PatientCheckinItem[] = items.map((item) => {
      const row = byItem.get(item.id);
      return {
        planItemId: item.id,
        title: item.title,
        kind: item.kind as PatientCheckinItem["kind"],
        status: row ? (row.status as "done" | "skipped") : null,
        reason: row?.reason ?? null,
      };
    });

    return { today: day, items: result };
  });

  app.post("/checkins", { preHandler: requireRole("patient") }, async (request, reply) => {
    const parsed = checkinSubmitSchema.safeParse(request.body);
    if (!parsed.success) return fail(reply, 400, "invalid_request", "Некорректная отметка");

    const patientId = requireAuth(request).userId;
    const [item] = await app.conn.db
      .select()
      .from(planItems)
      .where(and(eq(planItems.id, parsed.data.planItemId), eq(planItems.patientId, patientId)))
      .limit(1);

    if (!item) return notFound(reply, "Назначение не найдено");
    if (item.status !== "active") {
      return fail(reply, 409, "wrong_status", "Это назначение не входит в действующий план");
    }

    const reason = parsed.data.reason?.trim() ?? "";
    // A skip without a reason tells the doctor nothing they can act on.
    if (parsed.data.status === "skipped" && reason.length < REASON_MIN_LENGTH) {
      return fail(reply, 400, "invalid_request", "Опишите, что помешало — без причины пропуск не записывается");
    }

    const createdAt = new Date().toISOString();
    const checkinDate = parsed.data.checkinDate ?? createdAt.slice(0, 10);

    // Same rule as the diary: the patient's clock wins, but only by a day either way.
    const skewDays = Math.abs(Date.parse(checkinDate) - Date.parse(createdAt.slice(0, 10))) / 86_400_000;
    if (Number.isNaN(skewDays) || skewDays > 1) {
      return fail(reply, 400, "invalid_request", "Дата отметки вне допустимого диапазона");
    }

    // A mis-tap is corrected, not preserved: the same item and day is overwritten.
    const [saved] = await app.conn.db
      .insert(planCheckins)
      .values({
        id: randomUUID(),
        planItemId: item.id,
        patientId,
        checkinDate,
        status: parsed.data.status,
        reason: parsed.data.status === "skipped" ? reason : null,
        createdAt,
      })
      .onConflictDoUpdate({
        target: [planCheckins.planItemId, planCheckins.checkinDate],
        set: {
          status: parsed.data.status,
          reason: parsed.data.status === "skipped" ? reason : null,
          createdAt,
        },
      })
      .returning();

    return reply.code(200).send({
      checkin: {
        planItemId: saved!.planItemId,
        checkinDate: saved!.checkinDate,
        status: saved!.status,
        reason: saved!.reason,
      },
    });
  });

  app.get<{ Params: { id: string }; Querystring: { days?: string } }>(
    "/patients/:id/checkins",
    { preHandler: requireRole("doctor") },
    async (request, reply) => {
      const lookup = await loadPatientForDoctor(app, requireAuth(request).userId, request.params.id);
      if (!lookup.ok) {
        return lookup.status === 404
          ? notFound(reply, "Пациент не найден")
          : forbidden(reply, "Этого пациента ведёт другой врач");
      }

      const requested = Number(request.query.days ?? DEFAULT_WINDOW_DAYS);
      const windowDays =
        Number.isFinite(requested) && requested > 0
          ? Math.min(Math.trunc(requested), MAX_WINDOW_DAYS)
          : DEFAULT_WINDOW_DAYS;

      const day = today();
      const windowStart = shiftDate(day, -(windowDays - 1));

      const items = await app.conn.db
        .select()
        .from(planItems)
        .where(and(eq(planItems.patientId, lookup.patient.id), eq(planItems.status, "active")))
        .orderBy(asc(planItems.confirmedAt));

      const recorded = await app.conn.db
        .select()
        .from(planCheckins)
        .where(and(eq(planCheckins.patientId, lookup.patient.id), gte(planCheckins.checkinDate, windowStart)));

      const byItemDay = new Map(recorded.map((row) => [`${row.planItemId}:${row.checkinDate}`, row]));

      const result: AdherenceItem[] = items.map((item) => {
        const startedAt = (item.confirmedAt ?? item.createdAt).slice(0, 10);
        // Days before the prescription existed are not the patient's failure.
        const from = startedAt > windowStart ? startedAt : windowStart;
        const dates = from <= day ? dateRange(from, day) : [];

        const days: AdherenceDay[] = dates.map((date) => {
          const row = byItemDay.get(`${item.id}:${date}`);
          if (!row) return { date, state: "no_data", reason: null };
          return {
            date,
            state: row.status as "done" | "skipped",
            reason: row.reason,
          };
        });

        return {
          planItemId: item.id,
          title: item.title,
          kind: item.kind as AdherenceItem["kind"],
          startedAt,
          days,
          done: days.filter((entry) => entry.state === "done").length,
          skipped: days.filter((entry) => entry.state === "skipped").length,
          noData: days.filter((entry) => entry.state === "no_data").length,
        };
      });

      return { today: day, items: result };
    },
  );
};
