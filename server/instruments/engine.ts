import type { Instrument, InstrumentBand } from "./schema.js";

export class InvalidAnswers extends Error {}

export type Score = { total: number; band: InstrumentBand };

/**
 * Sum scoring with band lookup. Bands must cover the whole range: a score that
 * falls outside every band is a broken instrument, not a zero.
 */
export function score(instrument: Instrument, answers: Record<string, number>): Score {
  const allowed = new Set(instrument.options.map((option) => option.value));

  for (const item of instrument.items) {
    const value = answers[item.id];
    if (value === undefined) throw new InvalidAnswers(`пункт ${item.id} без ответа`);
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

/** True when a critical item (item 9 of the PHQ-9) carries a non-zero answer. */
export function criticalItems(instrument: Instrument, answers: Record<string, number>): string[] {
  return instrument.items
    .filter((item) => item.critical && (answers[item.id] ?? 0) > 0)
    .map((item) => item.id);
}
