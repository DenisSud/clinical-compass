import { desc, eq } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { requireAuth, requireRole } from "../auth/guard.js";
import { assessments, planItems } from "../db/schema.js";
import { forbidden, notFound } from "../http/errors.js";
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
        .select({ total: assessments.totalScore, bandId: assessments.bandId, bandLabel: assessments.bandLabel })
        .from(assessments)
        .where(eq(assessments.patientId, lookup.patient.id))
        .orderBy(desc(assessments.submittedAt))
        .limit(2);

      const plan = await app.conn.db
        .select({ title: planItems.title, status: planItems.status })
        .from(planItems)
        .where(eq(planItems.patientId, lookup.patient.id));

      const [latest, previous] = history;
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
          hasAssessment: latest !== undefined,
        },
        corpus(),
      );
    },
  );
};
