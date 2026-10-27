import { useState } from "react";
import { ApiRequestError, submitDiary } from "./api";
import { Button } from "./ui";

export function DiaryForm({ onSaved }: { onSaved: () => void }) {
  const [value, setValue] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (value === null) return;
    setBusy(true);
    setError(null);
    try {
      await submitDiary({
        submissionId: crypto.randomUUID(),
        value,
        comment: comment.trim() === "" ? undefined : comment.trim(),
        // the patient's own calendar day, so a late evening entry stays theirs
        entryDate: new Date().toLocaleDateString("sv-SE"),
      });
      setComment("");
      setSaved(true);
      onSaved();
    } catch (cause) {
      setError(cause instanceof ApiRequestError ? cause.message : "Не удалось сохранить");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <div className="diary-form__edges">
        <span>1 — очень плохо</span>
        <span>10 — хорошо</span>
      </div>
      <div className="diary-scale">
        {Array.from({ length: 10 }, (_, index) => index + 1).map((option) => (
          <button
            key={option}
            type="button"
            className="diary-scale__option"
            aria-pressed={value === option}
            onClick={() => {
              setValue(option);
              setSaved(false);
            }}
          >
            {option}
          </button>
        ))}
      </div>
      <p className="hint">
        {value === null ? "Выберите оценку — без выбора запись не сохранится." : " "}
      </p>
      <textarea
        className="field diary-form__comment"
        value={comment}
        onChange={(event) => setComment(event.target.value)}
        placeholder="Комментарий, если хочется что-то добавить"
        rows={3}
      />
      {error && <p className="notice notice--error">{error}</p>}
      {saved && <p className="notice notice--done">Запись сохранена.</p>}
      <Button
        type="submit"
        variant="primary"
        className="diary-form__submit"
        disabled={busy || value === null}
      >
        {busy ? "Сохраняем…" : "Записать самочувствие"}
      </Button>
    </form>
  );
}
