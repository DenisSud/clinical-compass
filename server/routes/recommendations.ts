import { desc, eq } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { requireAuth, requireRole } from "../auth/guard.js";
import { assessments, planItems } from "../db/schema.js";
import { forbidden, notFound } from "../http/errors.js";
import { instrument } from "../instruments/loader.js";
import { corpus } from "../knowledge/corpus.js";
import { loadPatientForDoctor } from "../patient-access.js";
import { recommendations, type RecommendationContext } from "../recommendations/service.js";

const WORSENING_DELTA = 5;

export const recommendationRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { id: string } }>(
    "/patients/:id/recommendations",
    { preHandler: requireRole("doctor") },
    async (request, reply) => {
      const lookup = await loadPatientForDoctor(app, requireAuth(request).userId, request.params.id);
      if (!lookup.ok) {
        return lookup.status === 404
          ? notFound(reply, "Пациент не найден")
          : forbidden(reply, "Этого пациента ведёт другой врач");
      }

      const history = await app.conn.db
        .select({
          instrumentId: assessments.instrumentId,
          instrumentVersion: assessments.instrumentVersion,
          total: assessments.totalScore,
          bandId: assessments.bandId,
          bandLabel: assessments.bandLabel,
        })
        .from(assessments)
        .where(eq(assessments.patientId, lookup.patient.id))
        .orderBy(desc(assessments.submittedAt));

      const plan = await app.conn.db
        .select({ title: planItems.title, status: planItems.status })
        .from(planItems)
        .where(eq(planItems.patientId, lookup.patient.id));

      // Динамика есть только у шкал с общей суммой: сумма UKU — число из разных явлений,
      // сравнивать её с чужой шкалой нельзя (SPEC S10, decisions.md §4).
      const summed = history.filter((row) => instrument(row.instrumentId)?.scoring === "sum");
      const latest = summed[0];
      const previous = latest
        ? summed.find(
            (row) =>
              row !== latest &&
              row.instrumentId === latest.instrumentId &&
              row.instrumentVersion === latest.instrumentVersion,
          )
        : undefined;

      const trend: RecommendationContext["trend"] =
        latest && previous
          ? latest.total - previous.total >= WORSENING_DELTA
            ? "worsening"
            : previous.total - latest.total >= WORSENING_DELTA
              ? "improving"
              : "flat"
          : latest
            ? "flat"
            : "unknown";

      return recommendations(
        {
          band: latest ? { id: latest.bandId, label: latest.bandLabel } : null,
          trend,
          activePlanTitles: plan.filter((item) => item.status === "active").map((item) => item.title),
          draftPlanTitles: plan.filter((item) => item.status === "draft").map((item) => item.title),
          hasAssessment: history.length > 0,
        },
        corpus(),
      );
    },
  );
};
