import { useCallback, useEffect, useState } from "react";
import type { PatientFacts, PatientFactsUpdate, PatientFactsView } from "../../shared/contracts";
import {
  FACT_QUESTIONS,
  UNANSWERED_ANSWER_LABEL,
  factQuestion,
  type FactQuestion,
} from "../../shared/facts";
import { ApiRequestError, fetchMyFacts, saveMyFacts } from "./api";
import { Button, Card, LoadError, loading, track, type Load } from "./ui";

type FactValue = PatientFacts[keyof PatientFacts];

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
}

/**
 * Один вопрос и его три состояния: ответ, второй ответ и «Не знаю» — то самое
 * отсутствие ответа, которое не прячется (GLOSSARY.md: «Не спрашивали»). Ни балла,
 * ни диапазона, ни тревожной окраски на «да»: интерпретация живёт у врача (§2.2),
 * поэтому ответ — просто выбранный вариант.
 */
function FactRow({
  question,
  value,
  onChange,
}: {
  question: FactQuestion;
  value: FactValue;
  onChange: (value: FactValue) => void;
}) {
  return (
    <li className="fact">
      <fieldset className="fact__fieldset">
        <legend className="fact__question">{question.question}</legend>
        {question.hint && <p className="hint">{question.hint}</p>}
        <div className="fact__answers">
          {question.kind === "number" && (
            <label className="fact__number">
              <span className="hint">
                {question.label}, {question.unit}
              </span>
              <input
                type="number"
                inputMode="decimal"
                step={question.step}
                min={question.min}
                max={question.max}
                value={typeof value === "number" ? String(value) : ""}
                onChange={(event) =>
                  onChange(event.target.value === "" ? null : Number(event.target.value))
                }
              />
            </label>
          )}

          {question.kind === "choice" &&
            question.answers.map((answer) => (
              <label key={answer.value} className="choice">
                <input
                  type="radio"
                  name={question.key}
                  checked={value === answer.value}
                  onChange={() => onChange(answer.value as FactValue)}
                />
                {answer.label}
              </label>
            ))}

          <label className="choice">
            <input
              type="radio"
              name={question.key}
              checked={value === null}
              onChange={() => onChange(null)}
            />
            {UNANSWERED_ANSWER_LABEL}
          </label>
        </div>
      </fieldset>
    </li>
  );
}

export function FactsForm() {
  const [view, setView] = useState<Load<PatientFactsView>>(loading());
  const [changes, setChanges] = useState<PatientFactsUpdate>({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const reload = useCallback(() => track(setView, fetchMyFacts()), []);

  useEffect(reload, [reload]);

  const dirty = Object.keys(changes).length > 0;

  function valueOf(key: keyof PatientFacts, facts: PatientFacts): FactValue {
    return Object.hasOwn(changes, key) ? (changes[key] ?? null) : facts[key];
  }

  function answer(key: keyof PatientFacts, value: FactValue) {
    setSaved(false);
    setFailure(null);
    setChanges((current) => ({ ...current, [key]: value }) as PatientFactsUpdate);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailure(null);
    try {
      const response = await saveMyFacts(changes);
      setView({ status: "ready", data: response });
      setChanges({});
      setSaved(true);
    } catch (cause) {
      setFailure(cause instanceof ApiRequestError ? cause.message : "Не удалось сохранить ответы");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Мои данные">
      <p className="muted">
        Шесть вопросов о том, что врачу нужно знать до назначения лечения. Отвечайте как есть, а
        если не знаете — так и отметьте.
      </p>

      {view.status === "loading" && <p className="notice">Загрузка ваших ответов…</p>}
      {view.status === "failed" && (
        <LoadError onRetry={reload}>
          Не удалось загрузить ваши ответы. Это не значит, что вы их не давали — повторите попытку.
        </LoadError>
      )}

      {view.status === "ready" && (
        <>
          {view.data.answeredAt && (
            <p className="hint">Последний раз вы отвечали {formatDate(view.data.answeredAt)}</p>
          )}

          <form onSubmit={submit}>
            <ul className="facts">
              {FACT_QUESTIONS.map((question) => (
                <FactRow
                  key={question.key}
                  question={question}
                  value={valueOf(question.key, view.data.facts)}
                  onChange={(value) => answer(question.key, value)}
                />
              ))}
            </ul>

            <div className="facts__actions">
              <Button type="submit" variant="primary" disabled={!dirty || busy}>
                {busy ? "Сохраняем…" : "Сохранить ответы"}
              </Button>
              {dirty && !busy && (
                <p className="hint">Ответы сохранятся, когда вы нажмёте «Сохранить ответы».</p>
              )}
              {saved && !dirty && <p className="notice">Ответы сохранены.</p>}
              {failure && <p className="notice notice--error">{failure}</p>}
            </div>
          </form>

          <section className="facts-gaps">
            <h3 className="section-title">О чём мы ещё не спрашивали</h3>
            {view.data.unanswered.length === 0 ? (
              <p className="notice">Спросили обо всём и записали ваши ответы.</p>
            ) : (
              <>
                <p className="notice">Это не оценка — просто вопросы, на которые у нас пока нет ответа.</p>
                <ul className="facts-gaps__list">
                  {view.data.unanswered.map((key) => (
                    <li key={key}>{factQuestion(key).label}</li>
                  ))}
                </ul>
              </>
            )}
          </section>
        </>
      )}
    </Card>
  );
}
