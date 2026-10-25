import { useState } from "react";
import type { DoctorSignal, Signal } from "../../shared/contracts";
import { ApiRequestError, closeSignal, takeSignal } from "./api";
import { Button, Empty, LoadError, type Load } from "./ui";

export const SIGNAL_SEVERITY_LABEL: Record<Signal["severity"], string> = {
  critical: "критично",
  high: "важно",
  medium: "обратить внимание",
};

export const SIGNAL_SEVERITY_COLOR: Record<Signal["severity"], string> = {
  critical: "var(--signal-critical)",
  high: "var(--signal-high)",
  medium: "var(--signal-medium)",
};

export const SIGNAL_STATUS_LABEL: Record<Signal["status"], string> = {
  saved: "новый",
  in_review: "в разборе",
  closed: "закрыт",
};

const SEVERITY_RANK: Record<Signal["severity"], number> = { critical: 0, high: 1, medium: 2 };

/** Severity first, newest second — the order the doctor reads, not the order the server sent (§3.7). */
export function sortSignals<T extends Signal>(signals: T[]): T[] {
  return [...signals].sort(
    (left, right) =>
      SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity] ||
      right.createdAt.localeCompare(left.createdAt),
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

/**
 * Controlled by DoctorHome so the open count in the header and the list on screen
 * can never disagree. Signal updates arrive from the server and replace the card
 * in place, so the doctor does not lose their position (§3.2, §5.6).
 */
export function SignalsPanel({
  signals,
  onRetry,
  onUpdated,
}: {
  signals: Load<DoctorSignal[]>;
  onRetry: () => void;
  onUpdated: (signal: DoctorSignal) => void;
}) {
  const [outcomes, setOutcomes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [failures, setFailures] = useState<Record<string, string>>({});

  async function take(signal: DoctorSignal) {
    setBusy(signal.id);
    setFailures((current) => ({ ...current, [signal.id]: "" }));
    try {
      const response = await takeSignal(signal.id);
      onUpdated({ ...signal, ...response.signal });
    } catch (cause) {
      setFailures((current) => ({
        ...current,
        [signal.id]: cause instanceof ApiRequestError ? cause.message : "Не удалось взять сигнал в разбор",
      }));
    } finally {
      setBusy(null);
    }
  }

  async function close(signal: DoctorSignal) {
    setBusy(signal.id);
    setFailures((current) => ({ ...current, [signal.id]: "" }));
    try {
      const response = await closeSignal(signal.id, outcomes[signal.id] ?? "");
      onUpdated({ ...signal, ...response.signal });
    } catch (cause) {
      setFailures((current) => ({
        ...current,
        [signal.id]: cause instanceof ApiRequestError ? cause.message : "Не удалось закрыть сигнал",
      }));
    } finally {
      setBusy(null);
    }
  }

  function renderCard(signal: DoctorSignal) {
    const outcome = outcomes[signal.id] ?? "";
    const canClose = outcome.trim().length >= 3;
    const failure = failures[signal.id];

    return (
      <li
        key={signal.id}
        className={signal.severity === "critical" ? "signal signal--critical" : "signal"}
      >
        <div className="signal__head">
          <span className="signal__severity" style={{ color: SIGNAL_SEVERITY_COLOR[signal.severity] }}>
            {SIGNAL_SEVERITY_LABEL[signal.severity]}
          </span>
          <span className="signal__status">{SIGNAL_STATUS_LABEL[signal.status]}</span>
        </div>
        <h3 className="signal__title">{signal.title}</h3>
        <p className="signal__meta">
          {signal.patient?.name ?? signal.patient?.email} · {formatDate(signal.createdAt)}
          {signal.watchItemId && " · по вашему правилу"}
        </p>
        <p className="signal__detail">{signal.detail}</p>

        {signal.status === "saved" && (
          <div className="signal__actions">
            <Button variant="primary" onClick={() => void take(signal)} disabled={busy === signal.id}>
              {busy === signal.id ? "Берём в разбор…" : "Взять в разбор"}
            </Button>
          </div>
        )}

        {signal.status === "in_review" && (
          <div className="signal__form">
            <textarea
              value={outcome}
              onChange={(event) =>
                setOutcomes((current) => ({ ...current, [signal.id]: event.target.value }))
              }
              placeholder="Результат разбора: что решили и что дальше"
              rows={2}
            />
            <div className="signal__actions">
              <Button
                variant="primary"
                onClick={() => void close(signal)}
                disabled={!canClose || busy === signal.id}
              >
                {busy === signal.id ? "Закрываем…" : "Закрыть с результатом"}
              </Button>
            </div>
            {!canClose && (
              <p className="hint">Без результата разбора сигнал не закрывается — запишите, что решили.</p>
            )}
          </div>
        )}

        {signal.status === "closed" && signal.outcome && (
          <p className="hint">
            <em>Результат:</em> {signal.outcome}
          </p>
        )}

        {failure && <p className="notice notice--error">{failure}</p>}
      </li>
    );
  }

  if (signals.status === "loading") return <p className="notice">Загрузка сигналов…</p>;

  if (signals.status === "failed") {
    return (
      <LoadError onRetry={onRetry}>
        Не удалось загрузить сигналы. Это не значит, что их нет — повторите попытку.
      </LoadError>
    );
  }

  const sorted = sortSignals(signals.data);
  const open = sorted.filter((signal) => signal.status !== "closed");
  const closed = sorted.filter((signal) => signal.status === "closed");

  return (
    <section aria-label="Сигналы">
      {open.length === 0 && (
        <Empty>
          {closed.length === 0 ? "Сигналов нет." : "Открытых сигналов нет."}
        </Empty>
      )}
      {open.length > 0 && <ul className="signal-list">{open.map(renderCard)}</ul>}

      {closed.length > 0 && (
        <details className="closed-group">
          <summary>Закрытые ({closed.length})</summary>
          <ul className="signal-list">{closed.map(renderCard)}</ul>
        </details>
      )}
    </section>
  );
}
