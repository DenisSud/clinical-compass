import { useCallback, useEffect, useState } from "react";
import { describeWatch, type WatchItem, type WatchKind } from "../../shared/contracts";
import { createWatchItem, fetchWatchItems, setWatchStatus } from "./api";

const KIND_LABEL: Record<WatchKind, string> = {
  diary_below: "Самочувствие ниже порога",
  diary_drop: "Резкое падение самочувствия",
  score_threshold: "Сумма опросника выше порога",
  missed_doses: "Пропуски приёма подряд",
  message_keyword: "Слова в сообщении",
};

const SEVERITY_LABEL = { medium: "средняя", high: "высокая", critical: "критичная" } as const;

/**
 * The doctor's own rules. They sit on top of the built-in safety net, which cannot
 * be switched off from here — a critical questionnaire answer always raises a signal.
 */
export function WatchPanel({ patientId }: { patientId: string }) {
  const [items, setItems] = useState<WatchItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<WatchKind>("diary_below");
  const [title, setTitle] = useState("");
  const [severity, setSeverity] = useState<WatchItem["severity"]>("high");
  const [value, setValue] = useState("3");
  const [terms, setTerms] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    setFailed(false);
    fetchWatchItems(patientId)
      .then((response) => setItems(response.items))
      .catch(() => setFailed(true));
  }, [patientId]);

  useEffect(reload, [reload]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const number = Number(value);
      const payload =
        kind === "message_keyword"
          ? { kind, title, severity, terms: terms.split(",").map((term) => term.trim()).filter(Boolean) }
          : kind === "score_threshold"
            ? { kind, title, severity, instrumentId: "phq-9", threshold: number }
            : kind === "missed_doses"
              ? { kind, title, severity, days: number }
              : kind === "diary_drop"
                ? { kind, title, severity, points: number }
                : { kind, title, severity, threshold: number };
      await createWatchItem(patientId, payload);
      setAdding(false);
      setTitle("");
      setTerms("");
      reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось сохранить правило");
    } finally {
      setBusy(false);
    }
  }

  if (failed) {
    return (
      <p style={{ color: "#b42318", fontSize: 14 }}>
        Не удалось загрузить правила наблюдения. Обновите страницу.
      </p>
    );
  }
  if (items === null) return <p style={{ color: "#777" }}>Загрузка…</p>;

  return (
    <div>
      {items.length === 0 && (
        <p style={{ color: "#555", marginTop: 0 }}>
          Своих правил нет. Работают только встроенные: критический ответ опросника, тяжёлая сумма,
          ухудшение, низкое самочувствие и резкое падение.
        </p>
      )}

      {items.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
          {items.map((item) => (
            <li
              key={item.id}
              style={{
                padding: 10,
                borderRadius: 8,
                border: "1px solid #d0d7de",
                opacity: item.status === "paused" ? 0.55 : 1,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <strong style={{ fontSize: 14 }}>{item.title}</strong>
                <span style={{ fontSize: 12, color: item.severity === "critical" ? "#b42318" : "#555" }}>
                  {SEVERITY_LABEL[item.severity]}
                </span>
              </div>
              <div style={{ fontSize: 13, color: "#555", marginTop: 2 }}>{describeWatch(item)}</div>
              <button
                type="button"
                onClick={async () => {
                  await setWatchStatus(item.id, item.status === "active" ? "pause" : "resume");
                  reload();
                }}
                style={{
                  marginTop: 6,
                  border: "none",
                  background: "none",
                  color: "#1f6feb",
                  cursor: "pointer",
                  padding: 0,
                  fontSize: 13,
                }}
              >
                {item.status === "active" ? "Приостановить" : "Включить обратно"}
              </button>
            </li>
          ))}
        </ul>
      )}

      {!adding && (
        <button
          type="button"
          onClick={() => setAdding(true)}
          style={{ marginTop: 10, padding: "8px 14px", borderRadius: 8, border: "1px solid #d0d7de", background: "white", cursor: "pointer" }}
        >
          Добавить риск
        </button>
      )}

      {adding && (
        <form onSubmit={submit} style={{ marginTop: 10, display: "grid", gap: 8 }}>
          <select
            value={kind}
            onChange={(event) => setKind(event.target.value as WatchKind)}
            style={{ padding: 8, borderRadius: 8, border: "1px solid #d0d7de" }}
          >
            {Object.entries(KIND_LABEL).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>

          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Название для врача, например «Риск самоповреждения»"
            style={{ padding: 8, borderRadius: 8, border: "1px solid #d0d7de" }}
          />

          {kind === "message_keyword" ? (
            <input
              value={terms}
              onChange={(event) => setTerms(event.target.value)}
              placeholder="Слова через запятую"
              style={{ padding: 8, borderRadius: 8, border: "1px solid #d0d7de" }}
            />
          ) : (
            <label style={{ fontSize: 13, color: "#555" }}>
              {kind === "missed_doses" ? "Пропусков подряд" : kind === "diary_drop" ? "Падение в баллах" : "Порог"}
              <input
                type="number"
                value={value}
                onChange={(event) => setValue(event.target.value)}
                style={{ marginLeft: 8, width: 80, padding: 6, borderRadius: 8, border: "1px solid #d0d7de" }}
              />
            </label>
          )}

          <select
            value={severity}
            onChange={(event) => setSeverity(event.target.value as WatchItem["severity"])}
            style={{ padding: 8, borderRadius: 8, border: "1px solid #d0d7de" }}
          >
            <option value="medium">средняя</option>
            <option value="high">высокая</option>
            <option value="critical">критичная</option>
          </select>

          {error && <p style={{ color: "#b42318", fontSize: 13, margin: 0 }}>{error}</p>}

          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="submit"
              disabled={busy || title.trim().length < 3}
              style={{
                minHeight: 40,
                padding: "0 16px",
                borderRadius: 8,
                border: "1px solid #1f6feb",
                background: "#1f6feb",
                color: "white",
                opacity: busy || title.trim().length < 3 ? 0.5 : 1,
                cursor: busy || title.trim().length < 3 ? "default" : "pointer",
              }}
            >
              Сохранить
            </button>
            <button
              type="button"
              onClick={() => setAdding(false)}
              style={{ minHeight: 40, padding: "0 16px", borderRadius: 8, border: "1px solid #d0d7de", background: "white", cursor: "pointer" }}
            >
              Отмена
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
