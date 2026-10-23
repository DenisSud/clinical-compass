import { useState } from "react";
import { ApiRequestError, submitDiary } from "./api";

export function DiaryForm({ onSaved }: { onSaved: () => void }) {
  const [value, setValue] = useState(5);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await submitDiary({
        submissionId: crypto.randomUUID(),
        value,
        comment: comment.trim() === "" ? undefined : comment.trim(),
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
      <label style={{ display: "block", fontSize: 14, color: "#555", marginBottom: 8 }}>
        Насколько вы сегодня себя чувствуете? 1 — очень плохо, 10 — хорошо.
      </label>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <input
          type="range"
          min={1}
          max={10}
          step={1}
          value={value}
          onChange={(event) => {
            setValue(Number(event.target.value));
            setSaved(false);
          }}
          style={{ flex: 1 }}
        />
        <strong style={{ fontSize: 20, width: 28, textAlign: "right" }}>{value}</strong>
      </div>
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
        disabled={busy}
        style={{
          marginTop: 8,
          padding: "10px 16px",
          borderRadius: 8,
          border: "none",
          background: "#1f6feb",
          color: "white",
          cursor: busy ? "progress" : "pointer",
        }}
      >
        Записать самочувствие
      </button>
    </form>
  );
}
