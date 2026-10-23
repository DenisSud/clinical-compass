import { useCallback, useEffect, useState } from "react";
import type { DoctorSignal } from "../../shared/contracts";
import { ApiRequestError, closeSignal, fetchSignals, takeSignal } from "./api";

const SEVERITY: Record<DoctorSignal["severity"], { label: string; color: string; background: string }> = {
  critical: { label: "критично", color: "#b42318", background: "#fff5f5" },
  high: { label: "важно", color: "#b54708", background: "#fffaeb" },
  medium: { label: "обратить внимание", color: "#475467", background: "#f5f7fa" },
};

const STATUS: Record<DoctorSignal["status"], string> = {
  saved: "новый",
  in_review: "в разборе",
  closed: "закрыт",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

export function SignalsPanel({ onChanged }: { onChanged?: () => void }) {
  const [signals, setSignals] = useState<DoctorSignal[] | null>(null);
  const [outcomes, setOutcomes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    fetchSignals()
      .then((response) => setSignals(response.signals))
      .catch(() => setSignals([]));
  }, []);

  useEffect(reload, [reload]);

  async function take(id: string) {
    setError(null);
    try {
      await takeSignal(id);
      reload();
      onChanged?.();
    } catch (cause) {
      setError(cause instanceof ApiRequestError ? cause.message : "Не удалось взять сигнал");
    }
  }

  async function close(id: string) {
    setError(null);
    try {
      await closeSignal(id, outcomes[id] ?? "");
      reload();
      onChanged?.();
    } catch (cause) {
      setError(cause instanceof ApiRequestError ? cause.message : "Не удалось закрыть сигнал");
    }
  }

  const open = signals?.filter((signal) => signal.status !== "closed") ?? [];

  return (
    <section style={{ marginTop: 32 }}>
      <h2 style={{ fontSize: 16 }}>
        Сигналы{open.length > 0 && <span style={{ color: "#b42318" }}> — {open.length}</span>}
      </h2>
      {signals === null && <p style={{ color: "#777" }}>Загрузка…</p>}
      {signals?.length === 0 && <p style={{ color: "#777" }}>Сигналов нет.</p>}
      {error && <p style={{ color: "#b42318", fontSize: 14 }}>{error}</p>}

      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 10 }}>
        {signals?.map((signal) => {
          const severity = SEVERITY[signal.severity];
          return (
            <li
              key={signal.id}
              style={{
                padding: 14,
                borderRadius: 10,
                border: "1px solid #d0d7de",
                borderLeft: `4px solid ${severity.color}`,
                background: signal.status === "closed" ? "#fafbfc" : "white",
                opacity: signal.status === "closed" ? 0.75 : 1,
              }}
            >
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span
                  style={{
                    fontSize: 12,
                    padding: "2px 8px",
                    borderRadius: 999,
                    color: severity.color,
                    background: severity.background,
                  }}
                >
                  {severity.label}
                </span>
                <strong style={{ fontSize: 15 }}>{signal.title}</strong>
                <span style={{ color: "#777", fontSize: 13 }}>
                  {signal.patient?.name ?? signal.patient?.email} · {formatDate(signal.createdAt)} ·{" "}
                  {STATUS[signal.status]}
                </span>
              </div>
              <p style={{ margin: "6px 0 0", color: "#333", fontSize: 14 }}>{signal.detail}</p>

              {signal.status === "saved" && (
                <button
                  type="button"
                  onClick={() => void take(signal.id)}
                  style={{ marginTop: 10, padding: "6px 12px", borderRadius: 8, border: "1px solid #d0d7de", background: "white", cursor: "pointer" }}
                >
                  Взять в разбор
                </button>
              )}

              {signal.status === "in_review" && (
                <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
                  <textarea
                    value={outcomes[signal.id] ?? ""}
                    onChange={(event) => setOutcomes((current) => ({ ...current, [signal.id]: event.target.value }))}
                    placeholder="Результат разбора: что решили и что дальше"
                    rows={2}
                    style={{ padding: 8, borderRadius: 8, border: "1px solid #d0d7de", fontFamily: "inherit", boxSizing: "border-box" }}
                  />
                  <button
                    type="button"
                    onClick={() => void close(signal.id)}
                    style={{ justifySelf: "start", padding: "6px 12px", borderRadius: 8, border: "none", background: "#1f6feb", color: "white", cursor: "pointer" }}
                  >
                    Закрыть с результатом
                  </button>
                </div>
              )}

              {signal.status === "closed" && signal.outcome && (
                <p style={{ margin: "8px 0 0", color: "#555", fontSize: 14 }}>
                  <em>Результат:</em> {signal.outcome}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
