import { optionsOf, type Instrument, type InstrumentBand } from "./schema.js";

export class InvalidAnswers extends Error {}

export type Score = { total: number; band: InstrumentBand };

/**
 * Суммарная оценка с поиском полосы. Полосы должны покрывать весь диапазон: сумма,
 * не попавшая ни в одну полосу, это сломанный инструмент, а не ноль.
 */
export function score(instrument: Instrument, answers: Record<string, number>): Score {
  for (const item of instrument.items) {
    const value = answers[item.id];
    if (value === undefined) throw new InvalidAnswers(`пункт ${item.id} без ответа`);
    const allowed = new Set(optionsOf(instrument, item).map((option) => option.value));
    if (!allowed.has(value)) throw new InvalidAnswers(`пункт ${item.id}: недопустимое значение`);
  }

  const unknown = Object.keys(answers).filter(
    (id) => !instrument.items.some((item) => item.id === id),
  );
  if (unknown.length > 0) throw new InvalidAnswers(`лишние пункты: ${unknown.join(", ")}`);

  const total = instrument.items.reduce((sum, item) => sum + (answers[item.id] ?? 0), 0);
  const band = instrument.bands.find((candidate) => total >= candidate.min && total <= candidate.max);
  if (!band) throw new Error(`инструмент ${instrument.id}: диапазон не покрывает ${total}`);

  return { total, band };
}

/** True, когда критический пункт (пункт 9 PHQ-9) несёт ненулевой ответ. */
export function criticalItems(instrument: Instrument, answers: Record<string, number>): string[] {
  return instrument.items
    .filter((item) => item.critical && (answers[item.id] ?? 0) > 0)
    .map((item) => item.id);
}
