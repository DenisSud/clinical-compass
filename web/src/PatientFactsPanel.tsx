import { useCallback, useEffect, useState } from "react";
import type { PatientFactsView } from "../../shared/contracts";
import { FACT_QUESTIONS, NOT_ASKED_LABEL, factAnswerText, factState } from "../../shared/facts";
import { fetchPatientFacts } from "./api";
import { LoadError, loading, track, type Load } from "./ui";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
}

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
  const marked = FACT_QUESTIONS.filter((question) => factState(question.key, facts) === "marked");
  const clear = FACT_QUESTIONS.filter((question) => factState(question.key, facts) === "clear");
  const notAsked = FACT_QUESTIONS.filter((question) => factState(question.key, facts) === "not_asked");
  const answeredCount = marked.length + clear.length;

  return (
    <div className="facts-report">
      <p className="hint">
        {answeredAt
          ? `Источник — ответы пациента от ${formatDate(answeredAt)}`
          : "Пациент ещё не отвечал на эти вопросы."}
      </p>

      <section>
        <h4 className="facts-report__title">Отмечено</h4>
        {marked.length > 0 ? (
          <ul className="facts-report__list">
            {marked.map((question) => (
              <li key={question.key}>
                <strong>{question.label}</strong> — {factAnswerText(question.key, facts)}
              </li>
            ))}
          </ul>
        ) : answeredCount === 0 ? (
          /*
           * Список «Отмечено» говорит только об отвеченном. Пока не отвечено ничего,
           * у него нет права говорить «ничего не отмечено»: рядом стоит «Не спрашивали»
           * на все шесть, и пропуск прочитался бы как благополучие (#51, GLOSSARY.md).
           */
          <p className="notice">Пока не о чем: ни на один из этих вопросов ещё нет ответа.</p>
        ) : (
          <p className="notice">Ничего из перечисленного не отмечено.</p>
        )}
      </section>

      <section>
        <h4 className="facts-report__title">{NOT_ASKED_LABEL}</h4>
        {notAsked.length === 0 ? (
          <p className="notice">Спросили обо всём.</p>
        ) : (
          <ul className="facts-report__list facts-report__list--muted">
            {notAsked.map((question) => (
              <li key={question.key}>{question.label}</li>
            ))}
          </ul>
        )}
      </section>

      {clear.length > 0 && (
        <section>
          <h4 className="facts-report__title">Не отмечено</h4>
          <ul className="facts-report__list facts-report__list--muted">
            {clear.map((question) => (
              <li key={question.key}>
                {question.label} — {factAnswerText(question.key, facts)}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
