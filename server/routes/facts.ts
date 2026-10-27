import { eq } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import type { ZodError, ZodIssue } from "zod";
import {
  patientFactsUpdateSchema,
  type PatientFacts,
  type PatientFactsView,
} from "../../shared/contracts.js";
import { factQuestion } from "../../shared/facts.js";
import { requireAuth, requireRole } from "../auth/guard.js";
import { patientFacts } from "../db/schema.js";
import { fail, forbidden, notFound } from "../http/errors.js";
import { loadPatientForDoctor } from "../patient-access.js";
import { factsSourceId } from "../decisions/facts.js";
import { runDecisionQuestions } from "../decisions/service.js";
import { toFacts } from "../patient-facts.js";
import { createHash } from "node:crypto";
import { signalsForFacts } from "../rules/signals.js";
import { saveSignals } from "./signals.js";

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
/**
 * Which facts are still missing. This is a completeness list, not a verdict:
 * the doctor needs to know what was never asked, the patient has the right to see
 * the same thing about themselves, and neither gets a score out of it.
 */
function unansweredOf(facts: PatientFacts): (keyof PatientFacts)[] {
  return FACT_KEYS.filter((key) => facts[key] === null);
}

/**
 * Почему ответ не принят — словами, которые называют поле. Zod говорит по-английски и
 * общими словами, а пациенту нужно знать, что исправить: имя поля — единственное, что
 * отличает опечатку от ответа (#53).
 */
function refusalMessage(error: ZodError): string {
  const unknown = error.issues.flatMap((issue) =>
    issue.code === "unrecognized_keys" ? issue.keys : [],
  );
  if (unknown.length > 0) {
    return `Неизвестное поле в ответах: ${unknown.join(", ")}. Ответ не сохранён — проверьте название поля`;
  }

  const parts = error.issues.map((issue) => {
    const key = issue.path[0];
    const label =
      typeof key === "string" && FACT_KEYS.some((candidate) => candidate === key)
        ? factQuestion(key as keyof PatientFacts).label
        : null;
    const reason = reasonOf(issue);
    return label ? `${label} — ${reason}` : reason;
  });

  return `Проверьте ответы: ${parts.join("; ")}`;
}

function reasonOf(issue: ZodIssue): string {
  switch (issue.code) {
    case "not_multiple_of":
      return "можно указать не больше одного знака после запятой";
    case "too_big":
      return `больше допустимого, максимум ${String(issue.maximum)}`;
    case "too_small":
      return `меньше допустимого, минимум ${String(issue.minimum)}`;
    default:
      return "такой ответ не подходит";
  }
}

function toView(row: FactsRow | undefined): PatientFactsView {
  const facts = toFacts(row);
  const unanswered = unansweredOf(facts);
  /*
   * `answeredAt` обещан как «когда пациент последний раз отвечал». Строка, где не
   * записано ни одного ответа, отвечает на это «никогда»: иначе врач читает дату
   * рядом с шестью «Не спрашивали» (#53).
   */
  const answered = unanswered.length < FACT_KEYS.length;
  return { facts, unanswered, answeredAt: answered ? (row?.updatedAt ?? null) : null };
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
      return fail(reply, 400, "validation_failed", refusalMessage(parsed.error));
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

    /*
     * Пустое тело — не ответ. Запрос, который ничего не сохранил, не имеет права
     * сдвинуть дату ответа и завести строку: врач читал бы «ответы от <дата>» рядом
     * с шестью «Не спрашивали» (#53).
     */
    if (Object.keys(patch).length === 0) return toView(existing);

    if (existing) {
      await app.conn.db
        .update(patientFacts)
        .set({ ...patch, updatedAt: now })
        .where(eq(patientFacts.patientId, patientId));
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

    /*
     * A contraindication written and never raised is a rule the doctor does not read
     * (issue #37). The facts row is one per patient, so `sourceId` is the patient: the
     * unique index on (source_type, source_id, kind) turns the second write of the same
     * facts into a no-op instead of a second card. A card already raised is not closed
     * by a later answer — closure is the doctor's action with an outcome (Q17).
     */
    const drafts = signalsForFacts(toFacts(row));

    /*
     * Факты пациента меняют ответы вопросов так же, как шкала: пересчёт по событию, а не
     * по кнопке «обновить» (Q44). `sourceId` — отпечаток ответов, а не пациент: с
     * постоянным id закрытая врачом карточка больше не поднялась бы никогда, а тот же
     * ответ, сохранённый дважды, не должен давать вторую (тот же довод, что ниже у правил).
     */
    await runDecisionQuestions(app, {
      patientId,
      sourceType: "facts",
      sourceId: factsSourceId(patientId, toFacts(row)),
    });

    /*
     * A second contraindication must not hide behind the first card. The unique index
     * dedupes on (source_type, source_id, kind), so a constant source id would swallow
     * every later answer: the patient adds an eGFR of 45 to a recorded pregnancy and
     * the doctor keeps a card that names only the pregnancy. The id carries a
     * fingerprint of what fired, so the same answers stay a no-op and a different set
     * raises its own card.
     */
    const fingerprint = createHash("sha1")
      .update(drafts.map((draft) => `${draft.kind}:${draft.detail}`).sort().join("|"))
      .digest("hex")
      .slice(0, 12);

    await saveSignals(app, {
      patientId,
      sourceType: "facts",
      sourceId: `${patientId}:${fingerprint}`,
      drafts,
    });

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
