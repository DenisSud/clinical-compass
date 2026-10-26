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
 *
 * Вопрос открывается тем, где он в списке («Вопрос N из 6»): шесть одинаковых блоков
 * прокручиваются, и только счётчик говорит, на каком из них пациент остановился
 * (§3.6). Выбранный вариант виден по всей строке, а не по точке 13 px в кружке
 * (system §2.7): подложка и маркер слева, как у ответа опросника. «Не знаю» — такой
 * же вариант в том же ритме, а не серая кнопка: это ответ, который пациенту можно
 * дать, и он не должен выглядеть единственным, что означает «ничего».
 *
 * `hasAnswer` отделяет «ответил «Не знаю»» от «ещё не спрашивали»: у обоих в
 * контракте `null`, но отметить кружок у нетронутого вопроса значило бы подставить
 * пациенту клинический факт, которого он не давал (system §4, п. 6).
 */
function FactRow({
  question,
  index,
  total,
  value,
  hasAnswer,
  onChange,
}: {
  question: FactQuestion;
  index: number;
  total: number;
  value: FactValue;
  hasAnswer: boolean;
  onChange: (value: FactValue) => void;
}) {
  return (
    <li className="fact">
      <fieldset className="fact__fieldset">
        <legend className="fact__legend">
          <span className="fact__counter">
            Вопрос {index} из {total}
          </span>
          <span className="fact__question">{question.question}</span>
        </legend>
        {question.hint && <p className="hint">{question.hint}</p>}
        <div className="fact__answers">
          {question.kind === "number" && (
            <label className="fact__number">
              <span className="fact__number-label">{question.label}</span>
              <span className="fact__number-field">
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
                <span className="fact__number-unit">{question.unit}</span>
              </span>
            </label>
          )}

          {question.kind === "choice" &&
            question.answers.map((answer) => (
              <label key={answer.value} className="choice">
                <input
                  type="radio"
                  name={question.key}
                  checked={hasAnswer && value === answer.value}
                  onChange={() => onChange(answer.value as FactValue)}
                />
                {answer.label}
              </label>
            ))}

          <label className="choice">
            <input
              type="radio"
              name={question.key}
              checked={hasAnswer && value === null}
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

  /* Ответ есть, если он пришёл с сервера или пациент изменил его на этом экране. */
  function hasAnswer(key: keyof PatientFacts, facts: PatientFacts): boolean {
    return Object.hasOwn(changes, key) || facts[key] !== null;
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
        Ответы увидит ваш врач. Если не знаете ответа, выберите «Не знаю» — это нормально.
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
              {FACT_QUESTIONS.map((question, index) => (
                <FactRow
                  key={question.key}
                  question={question}
                  index={index + 1}
                  total={FACT_QUESTIONS.length}
                  value={valueOf(question.key, view.data.facts)}
                  hasAnswer={hasAnswer(question.key, view.data.facts)}
                  onChange={(value) => answer(question.key, value)}
                />
              ))}
            </ul>

            <div className="facts__actions">
              <Button
                type="submit"
                variant="primary"
                className="facts__submit"
                disabled={!dirty || busy}
              >
                {busy ? "Сохраняем…" : "Сохранить ответы"}
              </Button>
              {saved && !dirty && <p className="notice">Ответы сохранены.</p>}
              {failure && <p className="notice notice--error">{failure}</p>}
              {/* Неактивная кнопка объясняет себя там, где она неактивна (§5, вопрос 5). */}
              {!dirty && !busy && !saved && (
                <p className="hint">Ответы сохранятся, когда вы нажмёте «Сохранить ответы».</p>
              )}
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
