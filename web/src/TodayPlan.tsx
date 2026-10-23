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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    setFailed(false);
    fetchCheckins()
      .then((response) => setItems(response.items))
      .catch(() => setFailed(true));
  }, []);

  useEffect(reload, [reload]);

  async function mark(planItemId: string, status: "done" | "skipped", why?: string) {
    setBusy(true);
    setError(null);
    try {
      await submitCheckin({ planItemId, status, reason: why });
      setEditing(null);
      setReason("");
      reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось сохранить отметку");
    } finally {
      setBusy(false);
    }
  }

  if (failed) {
    return (
      <p style={{ color: "#b42318", fontSize: 14 }}>
        Не удалось загрузить назначения. Это не значит, что их нет — обновите страницу.
      </p>
    );
  }
  if (items === null) return <p style={{ color: "#777" }}>Загрузка…</p>;
  if (items.length === 0) return null;

  return (
    <div>
      {error && <p style={{ color: "#b42318", fontSize: 14, marginTop: 0 }}>{error}</p>}
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 10 }}>
        {items.map((item) => (
          <li key={item.planItemId} style={{ padding: 12, borderRadius: 10, border: "1px solid #d0d7de" }}>
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
                    borderRadius: 8,
                    border: "1px solid #1f6feb",
                    background: "#1f6feb",
                    color: "white",
                    cursor: busy ? "progress" : "pointer",
                  }}
                >
                  Выполнил
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
                    borderRadius: 8,
                    border: "1px solid #d0d7de",
                    background: "white",
                    cursor: "pointer",
                  }}
                >
                  Пропустил
                </button>
              </div>
            )}

            {editing === item.planItemId && (
              <div style={{ marginTop: 8 }}>
                <label htmlFor={`reason-${item.planItemId}`} style={{ fontSize: 14, color: "#555" }}>
                  Что помешало?
                </label>
                <textarea
                  id={`reason-${item.planItemId}`}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  rows={2}
                  style={{ width: "100%", marginTop: 4, padding: 8, borderRadius: 8, border: "1px solid #d0d7de" }}
                />
                <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                  <button
                    type="button"
                    disabled={busy || reason.trim().length < 3}
                    onClick={() => mark(item.planItemId, "skipped", reason)}
                    style={{
                      minHeight: 44,
                      padding: "0 16px",
                      borderRadius: 8,
                      border: "1px solid #1f6feb",
                      background: "#1f6feb",
                      color: "white",
                      opacity: busy || reason.trim().length < 3 ? 0.5 : 1,
                      cursor: busy || reason.trim().length < 3 ? "default" : "pointer",
                    }}
                  >
                    Сохранить
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditing(null)}
                    style={{
                      minHeight: 44,
                      padding: "0 16px",
                      borderRadius: 8,
                      border: "1px solid #d0d7de",
                      background: "white",
                      cursor: "pointer",
                    }}
                  >
                    Отмена
                  </button>
                </div>
              </div>
            )}

            {item.status !== null && editing !== item.planItemId && (
              <div style={{ marginTop: 6, fontSize: 14 }}>
                {item.status === "done" ? (
                  <span style={{ color: "#1a7f37" }}>Выполнено</span>
                ) : (
                  <span style={{ color: "#b54708" }}>Пропущено: {item.reason}</span>
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
                    color: "#1f6feb",
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
