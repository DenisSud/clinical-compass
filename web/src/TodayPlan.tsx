import { useCallback, useEffect, useState } from "react";
import type { PatientCheckinItem } from "../../shared/contracts";
import { fetchCheckins, submitCheckin } from "./api";

/**
 * One place for the daily routine: what is prescribed, taken or not. The patient
 * picks one of two buttons — nothing is pre-marked, because a pre-marked dose is
 * a dose nobody actually confirmed.
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
      <p style={{ color: "var(--signal-critical)", fontSize: 14 }}>
        Не удалось загрузить назначения. Это не значит, что их нет — обновите страницу.
      </p>
    );
  }
  if (items === null) return <p className="notice">Загрузка назначений…</p>;
  if (items.length === 0) return <p className="notice">На сегодня назначений нет.</p>;

  const busy = busyId !== null;

  return (
    <div>
      {error && <p style={{ color: "var(--signal-critical)", fontSize: 14, marginTop: 0 }}>{error}</p>}
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 10 }}>
        {items.map((item) => (
          <li key={item.planItemId} style={{ padding: 12, borderRadius: "var(--radius-surface)", border: "1px solid var(--border-divider)" }}>
            <strong style={{ fontSize: 15 }}>{item.title}</strong>

            {item.status === null && editing !== item.planItemId && (
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => mark(item.planItemId, "done")}
                  style={{
                    minHeight: 44,
                    padding: "0 16px",
                    borderRadius: "var(--radius-surface)",
                    border: "1px solid var(--action-primary)",
                    background: "var(--action-primary)",
                    color: "var(--action-primary-ink)",
                    opacity: busy ? 0.5 : 1,
                    cursor: busy ? "progress" : "pointer",
                  }}
                >
                  {busyId === item.planItemId ? "Отмечаем…" : "Выполнил"}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setEditing(item.planItemId);
                    setReason("");
                    setError(null);
                  }}
                  style={{
                    minHeight: 44,
                    padding: "0 16px",
                    borderRadius: "var(--radius-surface)",
                    border: "1px solid var(--border-divider)",
                    background: "var(--surface-card)",
                    opacity: busy ? 0.5 : 1,
                    cursor: busy ? "default" : "pointer",
                  }}
                >
                  Пропустил
                </button>
              </div>
            )}

            {editing === item.planItemId && (
              <div style={{ marginTop: 8 }}>
                <label htmlFor={`reason-${item.planItemId}`} style={{ fontSize: 14, color: "var(--text-muted)" }}>
                  Что помешало?
                </label>
                <textarea
                  id={`reason-${item.planItemId}`}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  rows={2}
                  style={{ width: "100%", marginTop: 4, padding: 8, borderRadius: "var(--radius-surface)", border: "1px solid var(--border-divider)" }}
                />
                <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                  <button
                    type="button"
                    disabled={busy || reason.trim().length < 3}
                    onClick={() => mark(item.planItemId, "skipped", reason)}
                    style={{
                      minHeight: 44,
                      padding: "0 16px",
                      borderRadius: "var(--radius-surface)",
                      border: "1px solid var(--action-primary)",
                      background: "var(--action-primary)",
                      color: "var(--action-primary-ink)",
                      opacity: busy || reason.trim().length < 3 ? 0.5 : 1,
                      cursor: busy || reason.trim().length < 3 ? "default" : "pointer",
                    }}
                  >
                    {busyId === item.planItemId ? "Сохраняем…" : "Сохранить"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditing(null)}
                    style={{
                      minHeight: 44,
                      padding: "0 16px",
                      borderRadius: "var(--radius-surface)",
                      border: "1px solid var(--border-divider)",
                      background: "var(--surface-card)",
                      cursor: "pointer",
                    }}
                  >
                    Отмена
                  </button>
                </div>
                {reason.trim().length < 3 && (
                  <p className="hint">Без причины пропуск не сохраняется.</p>
                )}
              </div>
            )}

            {item.status !== null && editing !== item.planItemId && (
              <div style={{ marginTop: 6, fontSize: 14 }}>
                {item.status === "done" ? (
                  <span style={{ color: "var(--signal-done)" }}>Выполнено</span>
                ) : (
                  <span style={{ color: "var(--signal-high)" }}>Пропущено: {item.reason}</span>
                )}{" "}
                <button
                  type="button"
                  onClick={() => {
                    setEditing(item.planItemId);
                    setReason(item.status === "skipped" ? (item.reason ?? "") : "");
                  }}
                  style={{
                    border: "none",
                    background: "none",
                    color: "var(--link)",
                    cursor: "pointer",
                    fontSize: 14,
                    padding: 0,
                  }}
                >
                  изменить
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
