import { useCallback, useEffect, useState } from "react";
import type { InstrumentView } from "../../shared/contracts";
import { ApiRequestError, fetchInstrument, submitAssessment } from "./api";
import { LoadError } from "./ui";

const BUTTON = {
  minHeight: 44,
  padding: "10px 16px",
  borderRadius: "var(--radius-surface)",
  border: "none",
  background: "var(--action-primary)",
  color: "var(--action-primary-ink)",
  cursor: "pointer",
} as const;

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

  return (
    <form onSubmit={submit}>
      <p style={{ color: "var(--text-muted)", marginTop: 0 }}>{instrument.intro}</p>
      <ol style={{ paddingLeft: 20, display: "grid", gap: 16 }}>
        {instrument.items.map((item, index) => (
          <li key={item.id}>
            <p className="hint" style={{ margin: "0 0 4px" }}>
              Вопрос {index + 1} из {instrument.items.length}
            </p>
            <p style={{ margin: "0 0 8px" }}>{item.text}</p>
            <div style={{ display: "grid", gap: 4 }}>
              {instrument.options.map((option) => (
                <label key={option.value} style={{ display: "flex", gap: 8, fontSize: 14, color: "var(--text-body)" }}>
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
      {error && <p style={{ color: "var(--signal-critical)", fontSize: 14 }}>{error}</p>}
      <button type="submit" disabled={busy || !complete} style={{ ...BUTTON, opacity: !busy && complete ? 1 : 0.5, cursor: !busy && complete ? "pointer" : "default" }}>
        {busy ? "Отправляем…" : "Отправить ответы"}
      </button>
      {!complete && (
        <p className="hint">
          Отвечено {answered} из {instrument.items.length}. Отправить можно, когда ответите на все
          вопросы.
        </p>
      )}
      <p style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 0 }}>{instrument.sourceNote}</p>
    </form>
  );
}
