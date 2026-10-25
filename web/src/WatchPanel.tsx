import { useCallback, useEffect, useState } from "react";
import { describeWatch, type WatchItem, type WatchKind } from "../../shared/contracts";
import { createWatchItem, fetchWatchItems, setWatchStatus } from "./api";
import { Button, LoadError, loading, track, type Load } from "./ui";

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
  const [items, setItems] = useState<Load<WatchItem[]>>(loading());
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<WatchKind>("diary_below");
  const [title, setTitle] = useState("");
  const [severity, setSeverity] = useState<WatchItem["severity"]>("high");
  const [value, setValue] = useState("3");
  const [terms, setTerms] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toggleBusy, setToggleBusy] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);

  const reload = useCallback(() => {
    track(setItems, fetchWatchItems(patientId).then((response) => response.items));
  }, [patientId]);

  useEffect(reload, [reload]);

  async function toggle(item: WatchItem) {
    setToggleBusy(item.id);
    setToggleError(null);
    try {
      await setWatchStatus(item.id, item.status === "active" ? "pause" : "resume");
      reload();
    } catch {
      setToggleError("Не удалось изменить правило — повторите попытку.");
    } finally {
      setToggleBusy(null);
    }
  }

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

  if (items.status === "failed") {
    return (
      <LoadError onRetry={reload}>
        Не удалось загрузить правила наблюдения. Это не значит, что правил нет — повторите попытку.
      </LoadError>
    );
  }
  if (items.status === "loading") return <p className="notice">Загрузка правил…</p>;

  return (
    <div>
      {items.data.length === 0 && (
        <p className="muted">
          Своих правил нет. Работают только встроенные: критический ответ опросника, тяжёлая сумма,
          ухудшение, низкое самочувствие и резкое падение.
        </p>
      )}

      {items.data.length > 0 && (
        <ul className="watch-list">
          {items.data.map((item) => (
            <li
              key={item.id}
              className={item.status === "paused" ? "watch-item watch-item--paused" : "watch-item"}
            >
              <div className="watch-item__head">
                <strong className="watch-item__title">{item.title}</strong>
                <span
                  className={
                    item.severity === "critical"
                      ? "watch-item__severity watch-item__severity--critical"
                      : "watch-item__severity"
                  }
                >
                  {SEVERITY_LABEL[item.severity]}
                </span>
              </div>
              <div className="watch-item__detail">{describeWatch(item)}</div>
              <Button
                variant="quiet"
                className="watch-item__toggle"
                disabled={toggleBusy !== null}
                onClick={() => void toggle(item)}
              >
                {toggleBusy === item.id
                  ? item.status === "active"
                    ? "Приостанавливаем…"
                    : "Включаем…"
                  : item.status === "active"
                    ? "Приостановить"
                    : "Включить обратно"}
              </Button>
            </li>
          ))}
        </ul>
      )}

      {toggleError && <p className="notice notice--error">{toggleError}</p>}

      {!adding && (
        <Button className="watch-add" onClick={() => setAdding(true)}>
          Добавить риск
        </Button>
      )}

      {adding && (
        <form onSubmit={submit} className="watch-form">
          <select value={kind} onChange={(event) => setKind(event.target.value as WatchKind)}>
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
          />

          {kind === "message_keyword" ? (
            <input
              value={terms}
              onChange={(event) => setTerms(event.target.value)}
              placeholder="Слова через запятую"
            />
          ) : (
            <label className="watch-form__label">
              {kind === "missed_doses" ? "Пропусков подряд" : kind === "diary_drop" ? "Падение в баллах" : "Порог"}
              <input
                type="number"
                className="watch-form__number"
                value={value}
                onChange={(event) => setValue(event.target.value)}
              />
            </label>
          )}

          <select
            value={severity}
            onChange={(event) => setSeverity(event.target.value as WatchItem["severity"])}
          >
            <option value="medium">средняя</option>
            <option value="high">высокая</option>
            <option value="critical">критичная</option>
          </select>

          {error && <p className="notice notice--error">{error}</p>}
          {title.trim().length < 3 && (
            <p className="hint">Название — не короче 3 символов, иначе правило не сохранится.</p>
          )}

          <div className="row">
            <Button
              type="submit"
              variant="primary"
              disabled={busy || title.trim().length < 3}
            >
              {busy ? "Сохраняем…" : "Сохранить"}
            </Button>
            <Button type="button" onClick={() => setAdding(false)}>
              Отмена
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
