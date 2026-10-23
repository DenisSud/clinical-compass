import type { Instrument } from "../instruments/schema.js";

export type Severity = "critical" | "high" | "medium";

export type SignalDraft = {
  kind: string;
  severity: Severity;
  title: string;
  detail: string;
};

const CRITICAL_ITEM = "q9";
const SEVERE_TOTAL = 15;
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
  const critical = input.answers[CRITICAL_ITEM] ?? 0;

  if (critical > 0) {
    signals.push({
      kind: "critical_item",
      severity: "critical",
      title: "Отмечен критический пункт опросника",
      detail:
        "В ответах на PHQ-9 отмечены мысли о смерти или самоповреждении. Нужен разбор врачом.",
    });
  }

  if (input.total >= SEVERE_TOTAL) {
    signals.push({
      kind: "severe_total",
      severity: "high",
      title: `Выраженные проявления: ${input.total} из 27`,
      detail: "Сумма ответов попала в диапазон выраженных проявлений.",
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
