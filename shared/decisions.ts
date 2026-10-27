import { z } from "zod";
import { ruleConditionSchema, ruleSeveritySchema, ruleSourceSchema } from "./rules.js";

/**
 * Вопрос к данным — это правило, у которого есть формулировка вопроса и семантика «и».
 *
 * Правило срабатывает, если выполнено *любое* из условий: набор противопоказаний — одно
 * правило. Вопрос спрашивает о совпадении: «ухудшение **при** пропусках приёма» верно
 * только когда верно и то, и другое. Условия и источник — те же схемы, что у правил;
 * отличается смысл `when` и то, что ответ всегда называет вердикт, включая отказ.
 *
 * Модели в этом контракте нет: ответ детерминированный. Слот `ClinicalAssistant` не
 * используется, пока вопрос не сформулирован и не проверен (decisions.md Q44).
 */
export const decisionQuestionSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  /** Сам вопрос словами врача: «Ухудшение совпало с пропусками приёма?» */
  question: z.string().min(1),
  /** Все условия должны выполняться. Пустой список — ошибка: вопрос без условий отвечает «да» всем. */
  when: z.array(ruleConditionSchema).min(1),
  severity: ruleSeveritySchema,
  /** Текст сигнала. `{name}` заполняется из сработавших условий, как у правила. */
  output: z.strictObject({
    title: z.string().min(1),
    detail: z.string().min(1),
  }),
  source: ruleSourceSchema,
});

export type DecisionQuestion = z.infer<typeof decisionQuestionSchema>;

export const decisionQuestionsResponseSchema = z.object({
  questions: z.array(decisionQuestionSchema),
});

export type DecisionQuestionsResponse = z.infer<typeof decisionQuestionsResponseSchema>;
