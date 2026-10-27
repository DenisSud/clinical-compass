import type { Draft, TherapyCard } from "../../shared/contracts.js";

/**
 * Шов, куда сядет модель. Слайс 1 привёз это объявление и никакой реализации, чтобы никто
 * не мог случайно вызвать модель; теперь порт несёт ту форму, которая врачу действительно
 * нужна на экране.
 *
 * Каждый метод возвращает Draft: предложение без клинического эффекта, пока врач его не
 * подтвердил. Это правило живёт в типе, а не в подсказке модели.
 */
export type ClinicalAssistant = {
  summarizeHistory(input: { patientId: string }): Promise<Draft<string>>;
  draftConclusion(input: { patientId: string }): Promise<Draft<string>>;
  extractFacts(input: { patientId: string }): Promise<Draft<Record<string, string>>>;
  /**
   * Карточки рекомендаций. Каждая должна сказать, на чём стоит (`basis`) и чего ещё не хватает
   * для решения (`missing`). Карточка с пустым basis это ошибка, а не выбор стиля: кейс требует,
   * чтобы каждая рекомендация объясняла себя.
   */
  suggestTherapy(input: { patientId: string }): Promise<Draft<TherapyCard[]>>;
};
