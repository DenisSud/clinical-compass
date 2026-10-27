import { useCallback, useEffect, useState } from "react";
import type { InstrumentView } from "../../shared/contracts";
import { ApiRequestError, fetchInstrument, submitAssessment } from "./api";
import { Button, LoadError } from "./ui";

/**
 * Форма любого опросника из набора пациента. Описание приходит с сервера: вопросы,
 * варианты и вступление — данные, а не код. Пока форма была одна, она называлась по
 * шкале; теперь шкалу выбирает статус пациента, и форма обязана быть общей (issue #68).
 */
export function InstrumentForm({
  instrumentId,
  onSaved,
}: {
  instrumentId: string;
  onSaved: () => void;
}) {
  const [instrument, setInstrument] = useState<InstrumentView | null>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadInstrument = useCallback(() => {
    setError(null);
    // Ответы принадлежат шкале: id пунктов у шкал разные (q1…q9 у PHQ-9, a1…a7 и d1…d7
    // у HADS, u01…u48 у UKU), а варианты ответа — тем более.
    setAnswers({});
    fetchInstrument(instrumentId)
      .then((response) => setInstrument(response.instrument))
      .catch(() => setError("Не удалось загрузить опросник — повторите попытку."));
  }, [instrumentId]);

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
      await submitAssessment(instrumentId, { submissionId: crypto.randomUUID(), answers });
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
   * All nine items stay on one page. The export shows one question per screen with
   * «Назад / Дальше» (system §2.7); a wizard would hide the ninth item — the one about
   * suicidal thoughts — behind eight clicks, and the local answer map is what tells the
   * patient which items are still unanswered (DESIGN.md §2.1, §2.4; migration §1.3).
   * What is taken from the export: the visible choice on the whole row, «Вопрос N из 9»
   * as the place in the list (§3.6), the question at 17/700, the answers at 15 with 8 px
   * between them, and the submit button across the full width.
   */
  return (
    <form onSubmit={submit} className="instrument">
      <p className="muted">{instrument.intro}</p>
      <ol className="instrument__items">
        {instrument.items.map((item, index) => (
          <li key={item.id} className="instrument__item">
            <p className="instrument__counter">
              Вопрос {index + 1} из {instrument.items.length}
            </p>
            <p className="instrument__question">{item.text}</p>
            <div className="instrument__answers">
              {(item.options ?? instrument.options).map((option) => (
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
      <Button type="submit" variant="primary" className="instrument__submit" disabled={busy || !complete}>
        {busy ? "Отправляем…" : "Отправить ответы"}
      </Button>
      {!complete && (
        <p className="hint instrument__progress">
          Отвечено {answered} из {instrument.items.length}. Отправить можно, когда ответите на все
          вопросы.
        </p>
      )}
      <p className="instrument__source">{instrument.sourceNote}</p>
    </form>
  );
}
