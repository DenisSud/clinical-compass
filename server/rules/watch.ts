import type { WatchItem } from "../../shared/contracts.js";
import type { SignalDraft } from "./signals.js";

export type WatchEvent =
  | { type: "diary"; value: number; previousValue: number | null }
  | { type: "assessment"; instrumentId: string; total: number }
  | { type: "checkin"; consecutiveSkips: number }
  | { type: "message"; text: string };

export type WatchSignalDraft = SignalDraft & { watchItemId: string };

/**
 * The doctor's own rules, evaluated against one new event. Same contract as the
 * built-in rules: a signal is a question to look at, never an instruction.
 *
 * These are additions to the built-in safety net, not a replacement. Nothing here
 * can switch off the critical-item rule — that one is not the doctor's to disable.
 */
export function signalsForWatchItems(items: WatchItem[], event: WatchEvent): WatchSignalDraft[] {
  const drafts: WatchSignalDraft[] = [];

  for (const item of items) {
    if (item.status !== "active") continue;
    const detail = match(item, event);
    if (detail === null) continue;

    drafts.push({
      kind: "watch",
      severity: item.severity,
      title: item.title,
      detail,
      watchItemId: item.id,
    });
  }

  return drafts;
}

function match(item: WatchItem, event: WatchEvent): string | null {
  switch (item.kind) {
    case "diary_below": {
      if (event.type !== "diary") return null;
      const threshold = Number(item.params.threshold);
      if (!(event.value <= threshold)) return null;
      return `Пациент оценил самочувствие на ${event.value} из 10 — порог врача: ${threshold}.`;
    }

    case "diary_drop": {
      if (event.type !== "diary" || event.previousValue === null) return null;
      const points = Number(item.params.points);
      const drop = event.previousValue - event.value;
      if (!(drop >= points)) return null;
      return `Самочувствие упало с ${event.previousValue} до ${event.value} — на ${drop} при пороге ${points}.`;
    }

    case "score_threshold": {
      if (event.type !== "assessment") return null;
      if (event.instrumentId !== String(item.params.instrumentId)) return null;
      const threshold = Number(item.params.threshold);
      if (!(event.total >= threshold)) return null;
      return `Сумма ответов ${event.total} — порог врача: ${threshold}.`;
    }

    case "missed_doses": {
      if (event.type !== "checkin") return null;
      const days = Number(item.params.days);
      if (!(event.consecutiveSkips >= days)) return null;
      return `Пропусков приёма подряд: ${event.consecutiveSkips} при пороге ${days}.`;
    }

    case "message_keyword": {
      if (event.type !== "message") return null;
      const text = event.text.toLowerCase();
      const hit = (item.params.terms as string[]).find((term) =>
        text.includes(term.toLowerCase()),
      );
      if (!hit) return null;
      return `В сообщении пациента встретилось слово «${hit}».`;
    }

    default:
      return null;
  }
}
