import { useCallback, useEffect, useState } from "react";
import { describeWatch, type InstrumentChoice, type WatchItem, type WatchKind } from "../../shared/contracts";
import { createWatchItem, fetchPatientInstruments, fetchWatchItems, setWatchStatus } from "./api";
import { Button, LoadError, loading, track, type Load } from "./ui";

const KIND_LABEL: Record<WatchKind, string> = {
  diary_below: "Самочувствие ниже порога",
  diary_drop: "Резкое падение самочувствия",
  score_threshold: "Сумма опросника выше порога",
  missed_doses: "Пропуски приёма подряд",
  message_keyword: "Слова в сообщении",
};

const SEVERITY_LABEL = { medium: "средняя", high: "высокая", critical: "критичная" } as const;

/** Правило на паузе обязано это сказать: вставная поверхность сама по себе не говорит врачу, что оно выключено. */
const STATUS_LABEL: Record<WatchItem["status"], string> = {
  active: "активно",
  paused: "на паузе",
};

/**
 * Правила самого врача. Они лежат поверх встроенной страховки, которую отсюда
 * выключить нельзя: критический ответ в опроснике поднимает сигнал всегда.
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
  /** Набор пациента: правило на шкалу вне набора не сработает ни разу (#68). */
  const [instruments, setInstruments] = useState<InstrumentChoice[]>([]);
  const [instrumentId, setInstrumentId] = useState("");
  const [toggleError, setToggleError] = useState<string | null>(null);

  const reload = useCallback(() => {
    track(setItems, fetchWatchItems(patientId).then((response) => response.items));
  }, [patientId]);

  useEffect(reload, [reload]);

  useEffect(() => {
    fetchPatientInstruments(patientId)
      .then((response) => {
        // У шкалы без общей суммы нет порога: правило по ней не сработает ни разу (SPEC S10).
        const choices = response.instruments.filter((option) => option.scoring !== "items");
        setInstruments(choices);
        setInstrumentId((current) => current || choices[0]?.id || "");
      })
      .catch(() => setInstruments([]));
  }, [patientId]);

  const titles = Object.fromEntries(instruments.map((item) => [item.id, item.title]));

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
            ? { kind, title, severity, instrumentId, threshold: number }
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
              <div className="watch-item__body">
                <div className="watch-item__head">
                  <strong className="watch-item__title">{item.title}</strong>
                  <span className="watch-item__status">{STATUS_LABEL[item.status]}</span>
                </div>
                {/*
                 * Уровень это последнее слово в строке порога, в --text-muted: в экспорте он
                 * красной капсулой, а красная капсула в строке правила отняла бы единственный
                 * громкий акцент у карточки критического сигнала ниже (§2.3, §3.1).
                 */}
                <p className="watch-item__detail">
                  {describeWatch(item, titles)} · {SEVERITY_LABEL[item.severity]}
                </p>
              </div>
              <Button
                className="watch-item__toggle"
                disabled={toggleBusy !== null}
                onClick={() => void toggle(item)}
              >
                {toggleBusy === item.id
                  ? item.status === "active"
                    ? "Приостанавливаем…"
                    : "Возвращаем…"
                  : item.status === "active"
                    ? "Приостановить"
                    : "Вернуть"}
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

          {kind === "score_threshold" && (
            <label className="watch-form__label">
              Опросник
              <select value={instrumentId} onChange={(event) => setInstrumentId(event.target.value)}>
                {instruments.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.title}
                  </option>
                ))}
              </select>
            </label>
          )}

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
