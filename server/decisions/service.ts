import type { FastifyInstance } from "fastify";
import type { SignalDraft } from "../rules/signals.js";
import { saveSignals } from "../routes/signals.js";
import { factsFor } from "./facts.js";
import { answerQuestions } from "./runner.js";
import { listQuestions } from "./registry.js";

export type DecisionEvent = {
  patientId: string;
  sourceType: "assessment" | "diary" | "dose" | "facts";
  /** Идентификатор отправки, которая запустила пересчёт: он же дедуплицирует сигналы. */
  sourceId: string;
  now?: Date;
};

/**
 * Один шлюз для вопросов к данным. Каждое событие, меняющее картину пациента, пересчитывает
 * весь список на полных фактах, а не на тех, что принесла одна форма: вопрос «ухудшение при
 * пропусках» не может отвечать по шкале, не видя отметок приёма (decisions.md Q44).
 *
 * Сигнал получает только вердикт «да». Отказ не создаёт карточку: врач не должен получать
 * шум о том, что данных ещё нет. Отказы видны в площадке.
 */
export async function runDecisionQuestions(
  app: FastifyInstance,
  event: DecisionEvent,
): Promise<void> {
  const facts = await factsFor(app, event.patientId, event.now);
  const drafts: SignalDraft[] = answerQuestions(listQuestions(), facts)
    .filter((answer) => answer.verdict === "yes")
    .map((answer) => ({
      kind: `decision:${answer.questionId}`,
      severity: answer.severity as SignalDraft["severity"],
      title: answer.title as string,
      detail: answer.detail as string,
      ruleId: answer.questionId,
    }));

  await saveSignals(app, {
    patientId: event.patientId,
    sourceType: event.sourceType,
    sourceId: event.sourceId,
    drafts,
  });
}
