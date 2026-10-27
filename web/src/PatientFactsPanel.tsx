import { useCallback, useEffect, useState } from "react";
import type { PatientFactsView } from "../../shared/contracts";
import {
  FACT_QUESTIONS,
  NOT_ASKED_LABEL,
  factAnswerText,
  factState,
  type FactState,
} from "../../shared/facts";
import { fetchPatientFacts } from "./api";
import { LoadError, loading, track, type Load } from "./ui";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
}

/**
 * Слово о состоянии это первый канал: оно выживает в оттенках серого и в forced-colors, а
 * поверхность (заливка, контур, пунктир) его только подтверждает (signal-semantics.md §1).
 * «Не отмечено» и «Не спрашивали» остаются двумя разными словами: в экспорте они склеены в одну
 * строку с ответом, и это ровно та путаница, которую запрещает GLOSSARY.md.
 */
const STATE_LABEL: Record<FactState, string> = {
  marked: "Отмечено",
  clear: "Не отмечено",
  not_asked: NOT_ASKED_LABEL,
};

/**
 * Те же шесть фактов, что видит пациент, но с источником ответа. Врач читает их
 * рядом с сигналами: факт — это ответ пациента, а карточка сигнала ниже говорит,
 * какое правило из него что сделало. Своей оценки здесь нет — ни тяжести, ни вывода
 * (§2.2 работает в обе стороны: интерпретация живёт в сигнале, а не в факте).
 */
export function PatientFactsPanel({ patientId }: { patientId: string }) {
  const [view, setView] = useState<Load<PatientFactsView>>(loading());

  const reload = useCallback(() => {
    track(setView, fetchPatientFacts(patientId));
  }, [patientId]);

  useEffect(reload, [reload]);

  if (view.status === "loading") return <p className="notice">Загрузка ответов пациента…</p>;

  if (view.status === "failed") {
    return (
      <LoadError onRetry={reload}>
        Не удалось загрузить ответы пациента. Это не значит, что он их не давал.
      </LoadError>
    );
  }

  const { facts, answeredAt } = view.data;

  return (
    <div className="facts-report">
      {/*
       * Дата одна на все шесть ответов, а не на каждый: строка в базе одна, и подписать
       * ею каждый факт значило бы соврать про более ранние (`PatientFactsView.answeredAt`).
       */}
      <p className="hint">
        {answeredAt
          ? `Источник — ответы пациента от ${formatDate(answeredAt)}`
          : "Пациент ещё не отвечал на эти вопросы."}
      </p>

      <ul className="facts-cards">
        {FACT_QUESTIONS.map((question) => {
          const state = factState(question.key, facts);
          const answer = factAnswerText(question.key, facts);

          return (
            <li key={question.key} className={`fact-card fact-card--${state}`}>
              <p className="fact-card__state">{STATE_LABEL[state]}</p>
              <p className="fact-card__label">{question.label}</p>
              {/* У «не спрашивали» ответа не существует: выдуманного значения здесь нет. */}
              {answer !== null && <p className="fact-card__value">{answer}</p>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
