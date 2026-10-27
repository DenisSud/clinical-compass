import { useCallback, useEffect, useState } from "react";
import type { InstrumentView } from "../../shared/contracts";
import { ApiRequestError, fetchInstrument, submitAssessment } from "./api";
import { Button, LoadError } from "./ui";

export function Phq9Form({ onSaved }: { onSaved: () => void }) {
  const [instrument, setInstrument] = useState<InstrumentView | null>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadInstrument = useCallback(() => {
    setError(null);
    fetchInstrument("phq-9")
      .then((response) => setInstrument(response.instrument))
      .catch(() => setError("Не удалось загрузить опросник — повторите попытку."));
  }, []);

  useEffect(loadInstrument, [loadInstrument]);

  const answered = instrument
    ? instrument.items.filter((item) => answers[item.id] !== undefined).length
    : 0;
  const complete = instrument ? answered === instrument.items.length : false;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await submitAssessment("phq-9", { submissionId: crypto.randomUUID(), answers });
      setAnswers({});
      onSaved();
    } catch (cause) {
      setError(cause instanceof ApiRequestError ? cause.message : "Не удалось сохранить ответы");
    } finally {
      setBusy(false);
    }
  }

  if (!instrument) {
    return error ? (
      <LoadError onRetry={loadInstrument}>{error}</LoadError>
    ) : (
      <p className="notice">Загрузка опросника…</p>
    );
  }

  /*
   * Все девять пунктов остаются на одной странице. В экспорте один вопрос на экран с
   * «Назад / Дальше» (system §2.7); мастер спрятал бы девятый пункт, тот самый про
   * суицидальные мысли, за восемью нажатиями, а карта ответов на месте это то, что говорит
   * пациенту, на какие пункты он ещё не ответил (DESIGN.md §2.1, §2.4; migration §1.3).
   * Из экспорта взято: видимый выбор на всей строке, «Вопрос N из 9» как место в списке
   * (§3.6), вопрос 17/700, ответы 15 с 8 px между ними и кнопка отправки на всю ширину.
   */
  return (
    <form onSubmit={submit} className="phq9">
      <p className="muted">{instrument.intro}</p>
      <ol className="phq9__items">
        {instrument.items.map((item, index) => (
          <li key={item.id} className="phq9__item">
            <p className="phq9__counter">
              Вопрос {index + 1} из {instrument.items.length}
            </p>
            <p className="phq9__question">{item.text}</p>
            <div className="phq9__answers">
              {instrument.options.map((option) => (
                <label key={option.value} className="choice">
                  <input
                    type="radio"
                    name={item.id}
                    checked={answers[item.id] === option.value}
                    onChange={() => setAnswers((current) => ({ ...current, [item.id]: option.value }))}
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </li>
        ))}
      </ol>
      {error && (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" variant="primary" className="phq9__submit" disabled={busy || !complete}>
        {busy ? "Отправляем…" : "Отправить ответы"}
      </Button>
      {!complete && (
        <p className="hint phq9__progress">
          Отвечено {answered} из {instrument.items.length}. Отправить можно, когда ответите на все
          вопросы.
        </p>
      )}
      <p className="phq9__source">{instrument.sourceNote}</p>
    </form>
  );
}
