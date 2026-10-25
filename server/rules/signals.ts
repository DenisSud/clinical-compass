import type { Instrument } from "../instruments/schema.js";

export type Severity = "critical" | "high" | "medium";

export type SignalDraft = {
  kind: string;
  severity: Severity;
  title: string;
  detail: string;
};

const WORSENING_DELTA = 5;
const LOW_WELLBEING = 3;
const SHARP_DROP = 3;

/**
 * Rules read one submission plus what came before it and return the signals it
 * deserves. They never decide anything for the doctor: a signal is a question to
 * look at, not an instruction.
 */
export function signalsForAssessment(input: {
  instrument: Instrument;
  answers: Record<string, number>;
  total: number;
  previousTotal: number | null;
}): SignalDraft[] {
  const signals: SignalDraft[] = [];

  // The instrument says which items are critical and which band deserves a signal.
  // Nothing here may hardcode a questionnaire's item ids, bands or maximum: a second
  // instrument would silently inherit the first one's clinical rules.
  const flagged = input.instrument.items.filter(
    (item) => item.critical && (input.answers[item.id] ?? 0) > 0,
  );
  if (flagged.length > 0) {
    signals.push({
      kind: "critical_item",
      severity: "critical",
      title: "Отмечен критический пункт опросника",
      detail: `В ответах на «${input.instrument.title}» отмечены пункты, требующие разбора врачом: ${flagged
        .map((item) => item.id)
        .join(", ")}.`,
    });
  }

  const topScore = input.instrument.items.length * Math.max(...input.instrument.options.map((option) => option.value));
  const alertBand =
    input.instrument.bands.find((band) => band.id === input.instrument.alert?.bandId) ??
    [...input.instrument.bands].sort((left, right) => right.min - left.min)[0];

  // The alert band decides whether this is worth a signal. The label must come from
  // the band the score actually falls into, otherwise a 24 reads as "moderately severe".
  const actualBand = input.instrument.bands.find(
    (band) => input.total >= band.min && input.total <= band.max,
  );

  const bandIsSeverity = input.instrument.alert?.totalSignal !== false;

  if (bandIsSeverity && alertBand && actualBand && input.total >= alertBand.min) {
    signals.push({
      kind: "severe_total",
      severity: "high",
      title: `${actualBand.label}: ${input.total} из ${topScore}`,
      detail: `Сумма ответов попала в диапазон «${actualBand.label}» (${actualBand.min}–${actualBand.max}).`,
    });
  }

  if (input.previousTotal !== null && input.total - input.previousTotal >= WORSENING_DELTA) {
    signals.push({
      kind: "worsening",
      severity: "medium",
      title: `Ухудшение на ${input.total - input.previousTotal} балла`,
      detail: `Предыдущая сумма — ${input.previousTotal}, текущая — ${input.total}.`,
    });
  }

  return signals;
}

export function signalsForDiary(input: { value: number; previousValue: number | null }): SignalDraft[] {
  const signals: SignalDraft[] = [];

  if (input.value <= LOW_WELLBEING) {
    signals.push({
      kind: "low_wellbeing",
      severity: "high",
      title: `Самочувствие ${input.value} из 10`,
      detail: "Пациент оценил самочувствие как очень низкое.",
    });
  }

  if (input.previousValue !== null && input.previousValue - input.value >= SHARP_DROP) {
    signals.push({
      kind: "sharp_drop",
      severity: "medium",
      title: `Резкое снижение самочувствия на ${input.previousValue - input.value}`,
      detail: `Предыдущая оценка — ${input.previousValue}, текущая — ${input.value}.`,
    });
  }

  return signals;
}
