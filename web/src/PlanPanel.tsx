import { useCallback, useEffect, useState } from "react";
import type { PlanItem } from "../../shared/contracts";
import { ApiRequestError, archivePlanItem, confirmPlanItem, createPlanItem, fetchPatientPlan } from "./api";
import { Button, Empty, LoadError, loading, track, type Load } from "./ui";

const KIND: Record<PlanItem["kind"], string> = {
  medication: "Препарат",
  therapy: "Терапия",
  observation: "Наблюдение",
  referral: "Направление",
};

const STATUS: Record<PlanItem["status"], string> = {
  draft: "черновик",
  active: "подтверждён",
  archived: "в архиве",
};

export function PlanPanel({ patientId, onChanged }: { patientId: string; onChanged?: () => void }) {
  const [items, setItems] = useState<Load<PlanItem[]>>(loading());
  const [kind, setKind] = useState<PlanItem["kind"]>("medication");
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    track(setItems, fetchPatientPlan(patientId).then((response) => response.items));
  }, [patientId]);

  useEffect(reload, [reload]);

  async function act(key: string, action: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await action();
      reload();
      onChanged?.();
    } catch (cause) {
      setError(cause instanceof ApiRequestError ? cause.message : "Не удалось выполнить действие");
    } finally {
      setBusy(null);
    }
  }

  async function add(event: React.FormEvent) {
    event.preventDefault();
    if (title.trim() === "") {
      setError("Введите, что назначаем.");
      return;
    }
    await act("create", async () => {
      await createPlanItem(patientId, { kind, title, details: details.trim() === "" ? undefined : details });
      setTitle("");
      setDetails("");
    });
  }

  const blocked = busy !== null;

  return (
    <div>
      {items.status === "loading" && <p className="notice">Загрузка плана…</p>}

      {items.status === "failed" && (
        <LoadError onRetry={reload}>
          Не удалось загрузить план лечения. Это не значит, что плана нет — повторите попытку.
        </LoadError>
      )}

      {items.status === "ready" && items.data.length === 0 && (
        <Empty>Плана пока нет. Черновик ниже пациент не увидит до подтверждения.</Empty>
      )}

      {items.status === "ready" && items.data.length > 0 && (
        <ul className="stack" style={{ gap: 8, margin: "0 0 16px", padding: 0, listStyle: "none" }}>
          {items.data.map((item) => (
            <li
              key={item.id}
              style={{
                padding: 12,
                borderRadius: "var(--radius-surface)",
                border: "1px solid var(--border-divider)",
                borderLeft: `4px solid ${item.status === "active" ? "var(--signal-done)" : "var(--border-divider)"}`,
                background: item.status === "archived" ? "var(--surface-inset)" : "var(--surface-card)",
              }}
            >
              <div className="row" style={{ alignItems: "baseline" }}>
                <strong>{item.title}</strong>
                <span className="hint" style={{ margin: 0 }}>
                  {KIND[item.kind]} · {STATUS[item.status]}
                </span>
              </div>
              {item.details && <p style={{ margin: "4px 0 0", color: "var(--text-body)", fontSize: 14 }}>{item.details}</p>}
              <div className="row" style={{ marginTop: 10 }}>
                {item.status === "draft" && (
                  <Button
                    variant="primary"
                    disabled={blocked}
                    onClick={() => void act(`confirm:${item.id}`, () => confirmPlanItem(item.id))}
                  >
                    {busy === `confirm:${item.id}` ? "Подтверждаем…" : "Подтвердить"}
                  </Button>
                )}
                {item.status !== "archived" && (
                  <Button
                    disabled={blocked}
                    onClick={() => void act(`archive:${item.id}`, () => archivePlanItem(item.id))}
                  >
                    {busy === `archive:${item.id}` ? "Отправляем…" : "В архив"}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="notice notice--error">{error}</p>}

      <form onSubmit={add} className="stack" style={{ gap: 8, marginTop: 8 }}>
        <div className="row">
          <select
            value={kind}
            onChange={(event) => setKind(event.target.value as PlanItem["kind"])}
            aria-label="Тип назначения"
            style={{ padding: 8, borderRadius: "var(--radius-surface)", border: "1px solid var(--border-divider)" }}
          >
            {Object.entries(KIND).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Что назначаем"
            aria-label="Что назначаем"
            style={{
              flex: "1 1 160px",
              minWidth: 0,
              padding: 8,
              borderRadius: "var(--radius-surface)",
              border: "1px solid var(--border-divider)",
            }}
          />
        </div>
        <input
          value={details}
          onChange={(event) => setDetails(event.target.value)}
          placeholder="Как принимать, как часто (необязательно)"
          aria-label="Как принимать, как часто"
          style={{ padding: 8, borderRadius: "var(--radius-surface)", border: "1px solid var(--border-divider)" }}
        />
        <Button type="submit" disabled={blocked}>
          {busy === "create" ? "Сохраняем…" : "Добавить в черновик"}
        </Button>
        <p className="hint" style={{ margin: 0 }}>
          Пациент увидит пункт только после подтверждения.
        </p>
      </form>
    </div>
  );
}
