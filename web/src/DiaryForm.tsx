import { useState } from "react";
import { ApiRequestError, submitDiary } from "./api";

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
      <p style={{ display: "block", fontSize: 14, color: "#555", margin: "0 0 8px" }}>
        Насколько вы сегодня себя чувствуете? 1 — очень плохо, 10 — хорошо.
      </p>
      <div className="diary-scale">
        {Array.from({ length: 10 }, (_, index) => index + 1).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={value === option}
            onClick={() => {
              setValue(option);
              setSaved(false);
            }}
            style={{
              minHeight: 44,
              borderRadius: 8,
              border: value === option ? "2px solid #1f6feb" : "1px solid #d0d7de",
              background: value === option ? "#eef4ff" : "white",
              fontWeight: value === option ? 600 : 400,
              cursor: "pointer",
            }}
          >
            {option}
          </button>
        ))}
      </div>
      <p style={{ color: "#777", fontSize: 13, margin: "6px 0 0" }}>
        {value === null ? "Выберите оценку — без выбора запись не сохранится." : " "}
      </p>
      <textarea
        value={comment}
        onChange={(event) => setComment(event.target.value)}
        placeholder="Комментарий, если хочется что-то добавить"
        rows={3}
        style={{
          width: "100%",
          marginTop: 12,
          padding: 10,
          borderRadius: 8,
          border: "1px solid #d0d7de",
          fontFamily: "inherit",
          boxSizing: "border-box",
        }}
      />
      {error && <p style={{ color: "#b42318", fontSize: 14 }}>{error}</p>}
      {saved && <p style={{ color: "#1a7f37", fontSize: 14 }}>Запись сохранена.</p>}
      <button
        type="submit"
        disabled={busy || value === null}
        style={{
          marginTop: 8,
          minHeight: 44,
          opacity: busy || value === null ? 0.5 : 1,
          padding: "10px 16px",
          borderRadius: 8,
          border: "none",
          background: "#1f6feb",
          color: "white",
          cursor: busy || value === null ? "default" : "pointer",
        }}
      >
        {busy ? "Сохраняем…" : "Записать самочувствие"}
      </button>
    </form>
  );
}
