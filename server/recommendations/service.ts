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
  /** Всё, на что мы пока не можем ответить. Показывается врачу дословно. */
  missing: string[];
};

const NO_SMPC = "Нет ни одного текста ОХЛП — карточки препаратов не строятся";
const NO_GUIDELINE = "Нет клинических рекомендаций — основание «первая линия» нечем подтвердить";

/**
 * Строит карточки из корпуса, который у нас действительно есть. Модели здесь нет: это тот
 * уровень, который модели предстоит превзойти, и он честно говорит о пробелах. Каждая
 * карточка называет свой источник; когда источника нет, пробел перечисляется, а не
 * заполняется догадкой.
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
    // ОХЛП запрещает этот препарат при почечной и печёночной недостаточности, эпилепсии и на МАО.
    // Мы не держим об этом пациенте ни одного из этих фактов, поэтому карточка не может его снять.
    cardMissing.push(
      "Нет сведений о сопутствующих заболеваниях, функции почек и печени — противопоказания не проверены",
    );
    // Неизвестная динамика значит две разные вещи: измерений нет вовсе или они есть, но ни одно
    // не с суммой (UKU). Врач должен понять, чего именно не хватает (SPEC S10).
    if (context.trend === "unknown") {
      cardMissing.push(
        context.hasAssessment
          ? "Нет второй отправки шкалы с общей суммой — динамику оценить не на чем"
          : "Нет предыдущих измерений — динамику оценить не на чем",
      );
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

  // Карточка без основания это не рекомендация, а лозунг.
  const grounded = cards.filter((card) => card.basis !== "");
  const ungrounded = cards.filter((card) => card.basis === "");
  for (const card of ungrounded) {
    missing.push(`«${card.title}»: нет ни показаний в ОХЛП, ни рекомендаций — основание отсутствует`);
  }

  return { cards: grounded, missing };
}
