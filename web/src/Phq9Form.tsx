import { useEffect, useState } from "react";
import type { InstrumentView } from "../../shared/contracts";
import { ApiRequestError, fetchInstrument, submitAssessment } from "./api";

const BUTTON = {
  padding: "10px 16px",
  borderRadius: 8,
  border: "none",
  background: "#1f6feb",
  color: "white",
  cursor: "pointer",
} as const;

export function Phq9Form({ onSaved }: { onSaved: () => void }) {
  const [instrument, setInstrument] = useState<InstrumentView | null>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetchInstrument("phq-9")
      .then((response) => setInstrument(response.instrument))
      .catch(() => setError("Опросник недоступен"));
  }, []);

  const complete = instrument ? instrument.items.every((item) => answers[item.id] !== undefined) : false;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await submitAssessment("phq-9", { submissionId: crypto.randomUUID(), answers });
      setAnswers({});
      setSaved(true);
      onSaved();
    } catch (cause) {
      setError(cause instanceof ApiRequestError ? cause.message : "Не удалось сохранить");
    } finally {
      setBusy(false);
    }
  }

  if (!instrument) return <p style={{ color: "#777" }}>{error ?? "Загрузка опросника…"}</p>;

  if (saved) {
    return (
      <p style={{ color: "#1a7f37" }}>
        Ответы сохранены.{" "}
        <button
          type="button"
          onClick={() => setSaved(false)}
          style={{ background: "none", border: "none", color: "#1f6feb", cursor: "pointer", padding: 0 }}
        >
          Пройти ещё раз
        </button>
      </p>
    );
  }

  return (
    <form onSubmit={submit}>
      <p style={{ color: "#555", marginTop: 0 }}>{instrument.intro}</p>
      <ol style={{ paddingLeft: 20, display: "grid", gap: 16 }}>
        {instrument.items.map((item) => (
          <li key={item.id}>
            <p style={{ margin: "0 0 8px" }}>{item.text}</p>
            <div style={{ display: "grid", gap: 4 }}>
              {instrument.options.map((option) => (
                <label key={option.value} style={{ display: "flex", gap: 8, fontSize: 14, color: "#333" }}>
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
      {error && <p style={{ color: "#b42318", fontSize: 14 }}>{error}</p>}
      <button type="submit" disabled={busy || !complete} style={{ ...BUTTON, opacity: complete ? 1 : 0.5 }}>
        {complete ? "Отправить ответы" : "Ответьте на все пункты"}
      </button>
      <p style={{ color: "#777", fontSize: 13, marginBottom: 0 }}>{instrument.sourceNote}</p>
    </form>
  );
}
