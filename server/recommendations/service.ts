import type { TherapyCard } from "../../shared/contracts.js";
import type { KnowledgeDocument } from "../knowledge/corpus.js";

export type RecommendationContext = {
  band: { id: string; label: string } | null;
  trend: "improving" | "worsening" | "flat" | "unknown";
  activePlanTitles: string[];
  draftPlanTitles: string[];
  hasAssessment: boolean;
};

export type RecommendationResult = {
  cards: TherapyCard[];
  /** Everything we cannot answer yet. Shown to the doctor verbatim. */
  missing: string[];
};

const NO_SMPC = "Нет ни одного текста ОХЛП — карточки препаратов не строятся";
const NO_GUIDELINE = "Нет клинических рекомендаций — основание «первая линия» нечем подтвердить";

/**
 * Builds cards from the corpus we actually have. No model here: this is the floor
 * the model has to beat, and it is honest about the holes. Every card names its
 * source; when a source is absent, the hole is listed instead of filled with a guess.
 */
export function recommendations(
  context: RecommendationContext,
  documents: KnowledgeDocument[],
): RecommendationResult {
  const missing: string[] = [];
  const smpc = documents.filter((document) => document.kind === "smpc");
  const guidelines = documents.filter((document) => document.kind === "guideline");

  if (smpc.length === 0) missing.push(NO_SMPC);
  if (guidelines.length === 0) missing.push(NO_GUIDELINE);
  if (!context.hasAssessment) missing.push("Пациент не проходил опросник — состояние и тяжесть неизвестны");
  if (context.activePlanTitles.length === 0) {
    missing.push(
      context.draftPlanTitles.length > 0
        ? `План не подтверждён: ${context.draftPlanTitles.join(", ")} — пациент его не видит`
        : "Текущее лечение не зафиксировано в плане",
    );
  }

  const cards: TherapyCard[] = smpc.map((document) => {
    const basis =
      guidelines[0]?.sections.firstLine.trim() ||
      document.sections.indications.trim() ||
      "";

    const cardMissing: string[] = [];
    if (document.sections.contraindications.trim() === "") {
      cardMissing.push("В ОХЛП не указаны противопоказания");
    }
    if (document.sections.dosing.trim() === "") {
      cardMissing.push("В ОХЛП не указано дозирование");
    }
    // The ОХЛП forbids this drug in renal and hepatic impairment, epilepsy and on MAOIs.
    // We hold none of those facts about the patient, so the card cannot clear it.
    cardMissing.push(
      "Нет сведений о сопутствующих заболеваниях, функции почек и печени — противопоказания не проверены",
    );
    if (context.trend === "unknown") {
      cardMissing.push("Нет предыдущих измерений — динамику оценить не на чем");
    }
    if (context.trend === "worsening") {
      cardMissing.push("Состояние ухудшается — нужен разбор сигнала до смены терапии");
    }

    return {
      id: document.id,
      title: document.title,
      basis,
      missing: cardMissing,
      source: { kind: "smpc" as const, ref: document.title, url: document.source.url },
    };
  });

  // A card without a basis is not a recommendation, it is a slogan.
  const grounded = cards.filter((card) => card.basis !== "");
  const ungrounded = cards.filter((card) => card.basis === "");
  for (const card of ungrounded) {
    missing.push(`«${card.title}»: нет ни показаний в ОХЛП, ни рекомендаций — основание отсутствует`);
  }

  return { cards: grounded, missing };
}
