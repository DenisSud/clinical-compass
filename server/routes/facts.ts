import { eq } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import {
  patientFactsUpdateSchema,
  type PatientFacts,
  type PatientFactsView,
} from "../../shared/contracts.js";
import { requireAuth, requireRole } from "../auth/guard.js";
import { patientFacts } from "../db/schema.js";
import { fail, forbidden, notFound } from "../http/errors.js";
import { loadPatientForDoctor } from "../patient-access.js";

type FactsRow = typeof patientFacts.$inferSelect;

const FACT_KEYS: (keyof PatientFacts)[] = [
  "epilepsyOrOrganicBrainDisease",
  "maoInhibitors",
  "egfrMlMin",
  "childPugh",
  "pregnancy",
  "galactoseIntolerance",
];

const NOT_YOURS = "Этот пациент ведёт другой врач";

/** An absent row and a row of nulls mean the same thing: nothing was asked yet. */
function toFacts(row: FactsRow | undefined): PatientFacts {
  return {
    epilepsyOrOrganicBrainDisease:
      (row?.epilepsyOrOrganicBrainDisease as PatientFacts["epilepsyOrOrganicBrainDisease"]) ?? null,
    maoInhibitors: (row?.maoInhibitors as PatientFacts["maoInhibitors"]) ?? null,
    egfrMlMin: row?.egfrMlMin ?? null,
    childPugh: (row?.childPugh as PatientFacts["childPugh"]) ?? null,
    pregnancy: (row?.pregnancy as PatientFacts["pregnancy"]) ?? null,
    galactoseIntolerance:
      (row?.galactoseIntolerance as PatientFacts["galactoseIntolerance"]) ?? null,
  };
}

/**
 * Which facts are still missing. This is a completeness list, not a verdict:
 * the doctor needs to know what was never asked, the patient has the right to see
 * the same thing about themselves, and neither gets a score out of it.
 */
function unansweredOf(facts: PatientFacts): (keyof PatientFacts)[] {
  return FACT_KEYS.filter((key) => facts[key] === null);
}

function toView(row: FactsRow | undefined): PatientFactsView {
  const facts = toFacts(row);
  return { facts, unanswered: unansweredOf(facts) };
}

export const factsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/facts", { preHandler: requireRole("patient") }, async (request) => {
    const patientId = requireAuth(request).userId;
    const [row] = await app.conn.db
      .select()
      .from(patientFacts)
      .where(eq(patientFacts.patientId, patientId))
      .limit(1);

    return toView(row);
  });

  /**
   * Partial writes on purpose: a patient may answer three questions today and the
   * rest later. An omitted field keeps its value; an explicit `null` clears it back
   * to «не спрашивали», which is a legitimate answer to give.
   */
  app.put("/facts", { preHandler: requireRole("patient") }, async (request, reply) => {
    const parsed = patientFactsUpdateSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return fail(reply, 400, "validation_failed", "Проверьте ответы: часть значений не подходит");
    }

    const patientId = requireAuth(request).userId;
    const now = new Date().toISOString();
    const patch: Partial<FactsRow> = {};
    for (const [key, value] of Object.entries(parsed.data)) {
      if (value !== undefined) patch[key as keyof FactsRow] = value as never;
    }

    const [existing] = await app.conn.db
      .select()
      .from(patientFacts)
      .where(eq(patientFacts.patientId, patientId))
      .limit(1);

    if (existing) {
      if (Object.keys(patch).length > 0) {
        await app.conn.db
          .update(patientFacts)
          .set({ ...patch, updatedAt: now })
          .where(eq(patientFacts.patientId, patientId));
      }
    } else {
      await app.conn.db
        .insert(patientFacts)
        .values({ patientId, updatedAt: now, ...patch });
    }

    const [row] = await app.conn.db
      .select()
      .from(patientFacts)
      .where(eq(patientFacts.patientId, patientId))
      .limit(1);

    return toView(row);
  });

  /** The doctor reads the same list; what they do with it is their decision, not ours. */
  app.get<{ Params: { id: string } }>(
    "/patients/:id/facts",
    { preHandler: requireRole("doctor") },
    async (request, reply) => {
      const lookup = await loadPatientForDoctor(app, requireAuth(request).userId, request.params.id);
      if (!lookup.ok) {
        return lookup.status === 404 ? notFound(reply, "Пациент не найден") : forbidden(reply, NOT_YOURS);
      }

      const [row] = await app.conn.db
        .select()
        .from(patientFacts)
        .where(eq(patientFacts.patientId, lookup.patient.id))
        .limit(1);

      return toView(row);
    },
  );
};
