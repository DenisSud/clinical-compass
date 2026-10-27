import { useCallback, useEffect, useState } from "react";
import type { InstrumentView } from "../../shared/contracts";
import {
  ApiRequestError,
  fetchDoctorInstrument,
  fetchInstrument,
  submitAssessment,
  submitDoctorAssessment,
} from "./api";
import { Button, LoadError } from "./ui";

/**
 * Форма любого опросника. Описание приходит с сервера: вопросы, варианты и вступление —
 * данные, а не код. Без `patientId` форма пациентская (шкала из своего набора), с ним —
 * врачебная: шкалу и отправку задаёт карточка пациента, и маршрут другой (SPEC S14, Q53).
 */
export function InstrumentForm({
  instrumentId,
  patientId,
  onSaved,
}: {
  instrumentId: string;
  /** Карточка пациента для врачебной шкалы; у пациента её нет — он читает свои шкалы. */
  patientId?: string;
  onSaved: () => void;
}) {
  const [instrument, setInstrument] = useState<InstrumentView | null>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadInstrument = useCallback(() => {
    setError(null);
    // Ответы принадлежат шкале: id пунктов у шкал разные (q1…q9 у PHQ-9, a1…a7 и d1…d7
    // у HADS, u01…u48 у UKU, h01…h17 у HDRS-17), а варианты ответа — тем более.
    setAnswers({});
    const request =
      patientId === undefined
        ? fetchInstrument(instrumentId)
        : fetchDoctorInstrument(patientId, instrumentId);
    request
      .then((response) => setInstrument(response.instrument))
      .catch(() => setError("Не удалось загрузить опросник — повторите попытку."));
  }, [instrumentId, patientId]);

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
      const submissionId = crypto.randomUUID();
      if (patientId === undefined) {
        await submitAssessment(instrumentId, { submissionId, answers });
      } else {
        await submitDoctorAssessment(patientId, { submissionId, instrumentId, answers });
      }
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
