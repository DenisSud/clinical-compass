import { useState } from "react";
import type { Message } from "../../shared/contracts";
import { ApiRequestError } from "./api";

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("ru-RU", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function MessageThread({
  messages,
  onSend,
  placeholder,
}: {
  messages: Message[];
  onSend: (body: string) => Promise<unknown>;
  placeholder: string;
}) {
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (body.trim() === "") {
      setError("Напишите сообщение.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSend(body);
      setBody("");
    } catch (cause) {
      setError(cause instanceof ApiRequestError ? cause.message : "Не удалось отправить");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {messages.length === 0 && <p style={{ color: "#777", marginTop: 0 }}>Сообщений пока нет.</p>}
      <ul style={{ listStyle: "none", padding: 0, margin: "0 0 12px", display: "grid", gap: 8 }}>
        {messages.map((message) => {
          const mine = message.authorRole === "patient";
          return (
            <li
              key={message.id}
              style={{
                padding: "10px 12px",
                borderRadius: 10,
                background: mine ? "#f5f7fa" : "#eef4ff",
                marginLeft: mine ? 0 : 24,
                marginRight: mine ? 24 : 0,
              }}
            >
              <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{message.body}</p>
              <p style={{ margin: "6px 0 0", fontSize: 12, color: "#777" }}>
                {message.authorRole === "patient" ? "Пациент" : "Врач"} · {formatTime(message.createdAt)}
              </p>
            </li>
          );
        })}
      </ul>

      <form onSubmit={submit} style={{ display: "grid", gap: 6 }}>
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder={placeholder}
          rows={3}
          style={{ padding: 10, borderRadius: 8, border: "1px solid #d0d7de", fontFamily: "inherit", boxSizing: "border-box" }}
        />
        {error && <p style={{ color: "#b42318", fontSize: 14, margin: 0 }}>{error}</p>}
        <button
          type="submit"
          disabled={busy}
          style={{
            justifySelf: "start",
            minHeight: 44,
            padding: "8px 14px",
            borderRadius: 8,
            border: "none",
            background: "#1f6feb",
            color: "white",
            cursor: busy ? "progress" : "pointer",
            opacity: busy ? 0.5 : 1,
          }}
        >
          {busy ? "Отправляем…" : "Отправить"}
        </button>
      </form>
    </div>
  );
}
