import { useCallback, useEffect, useState } from "react";
import type { PatientCheckinItem } from "../../shared/contracts";
import { fetchCheckins, submitCheckin } from "./api";
import { Button } from "./ui";

/**
 * Одно место для ежедневной рутины: что назначено, принято или нет. Пациент выбирает
 * одну из двух кнопок, ничего не отмечено заранее, потому что заранее отмеченный приём
 * это приём, который никто на самом деле не подтверждал.
 */
export function TodayPlan() {
  const [items, setItems] = useState<PatientCheckinItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    setFailed(false);
    fetchCheckins()
      .then((response) => setItems(response.items))
      .catch(() => setFailed(true));
  }, []);

  useEffect(reload, [reload]);

  async function mark(planItemId: string, status: "done" | "skipped", why?: string) {
    setBusyId(planItemId);
    setError(null);
    try {
      await submitCheckin({ planItemId, status, reason: why });
      setEditing(null);
      setReason("");
      reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось сохранить отметку");
    } finally {
      setBusyId(null);
    }
  }

  if (failed) {
    return (
      <p className="notice notice--error">
        Не удалось загрузить назначения. Это не значит, что их нет — обновите страницу.
      </p>
    );
  }
  if (items === null) return <p className="notice">Загрузка назначений…</p>;
  if (items.length === 0) return <p className="notice">На сегодня назначений нет.</p>;

  const busy = busyId !== null;

  return (
    <>
      {error && <p className="notice notice--error">{error}</p>}
      <ul className="intake">
        {items.map((item) => (
          <li key={item.planItemId} className="intake__item">
            <p className="intake__title">{item.title}</p>

            {item.status === null && editing !== item.planItemId && (
              <div className="intake__actions">
                <Button
                  variant="primary"
                  disabled={busy}
                  onClick={() => mark(item.planItemId, "done")}
                >
                  {busyId === item.planItemId ? "Отмечаем…" : "Выполнил"}
                </Button>
                <Button
                  disabled={busy}
                  onClick={() => {
                    setEditing(item.planItemId);
                    setReason("");
                    setError(null);
                  }}
                >
                  Пропустил
                </Button>
              </div>
            )}

            {editing === item.planItemId && (
              <div>
                <label className="intake__reason-label" htmlFor={`reason-${item.planItemId}`}>
                  Что помешало?
                </label>
                <textarea
                  id={`reason-${item.planItemId}`}
                  className="field"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  rows={2}
                />
                <div className="intake__actions">
                  <Button
                    variant="primary"
                    disabled={busy || reason.trim().length < 3}
                    onClick={() => mark(item.planItemId, "skipped", reason)}
                  >
                    {busyId === item.planItemId ? "Сохраняем…" : "Сохранить"}
                  </Button>
                  <Button onClick={() => setEditing(null)}>Отмена</Button>
                </div>
                {reason.trim().length < 3 && (
                  <p className="hint">Без причины пропуск не сохраняется.</p>
                )}
              </div>
            )}

            {item.status !== null && editing !== item.planItemId && (
              <p className="intake__status">
                {item.status === "done" ? (
                  <span className="intake__status--done">Выполнено</span>
                ) : (
                  <span className="intake__status--skipped">Пропущено: {item.reason}</span>
                )}
                <Button
                  variant="quiet"
                  onClick={() => {
                    setEditing(item.planItemId);
                    setReason(item.status === "skipped" ? (item.reason ?? "") : "");
                  }}
                >
                  изменить
                </Button>
              </p>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
