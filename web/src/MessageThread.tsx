import { useState } from "react";
import type { Message } from "../../shared/contracts";
import { ApiRequestError } from "./api";
import { Button, Empty } from "./ui";

/** Whose screen the thread is on: it decides which side is «Вы» and which is the counterpart. */
export type MessageViewer = "patient" | "doctor";

/*
 * В экспорте автор подписан подписью внутри пузыря, «Пациент · 25 октября,
 * 09:14» (system §2.15), и один и тот же пузырь подписан по-разному на двух экранах:
 * на странице пациента сообщение врача это «Врач», на странице врача то же самое
 * сообщение это «Пациент». Поэтому слово берётся из роли читателя, а не из литерала.
 */
function authorLabel(viewer: MessageViewer, authorRole: Message["authorRole"]): string {
  if (authorRole === viewer) return "Вы";
  return viewer === "doctor" ? "Пациент" : "Врач";
}

/* «25 октября, 09:12» — a comma, as in the export; ru-RU joins day and time with «в». */
function formatStamp(iso: string): string {
  const date = new Date(iso);
  const day = date.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
  const time = date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  return `${day}, ${time}`;
}

export function MessageThread({
  messages,
  viewer,
  onSend,
  placeholder,
}: {
  messages: Message[];
  viewer: MessageViewer;
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
      {messages.length === 0 && <Empty>Сообщений пока нет.</Empty>}
      <ul className="thread__list">
        {messages.map((message) => {
          const mine = message.authorRole === viewer;
          return (
            <li key={message.id} className={mine ? "thread__item thread__item--mine" : "thread__item"}>
              <div className="thread__bubble">
                <p className="thread__meta">
                  {authorLabel(viewer, message.authorRole)} · {formatStamp(message.createdAt)}
                </p>
                <p className="thread__body">{message.body}</p>
              </div>
            </li>
          );
        })}
      </ul>

      <form className="thread__form" onSubmit={submit}>
        <textarea
          className="thread__field"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          rows={3}
        />
        {error && <p className="notice notice--error">{error}</p>}
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? "Отправляем…" : "Отправить"}
        </Button>
      </form>
    </div>
  );
}
