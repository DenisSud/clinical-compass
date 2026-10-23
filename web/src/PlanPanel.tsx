import { useCallback, useEffect, useState } from "react";
import type { PlanItem } from "../../shared/contracts";
import { ApiRequestError, archivePlanItem, confirmPlanItem, createPlanItem, fetchPatientPlan } from "./api";

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
  const [items, setItems] = useState<PlanItem[] | null>(null);
  const [kind, setKind] = useState<PlanItem["kind"]>("medication");
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    fetchPatientPlan(patientId)
      .then((response) => setItems(response.items))
      .catch(() => setItems([]));
  }, [patientId]);

  useEffect(reload, [reload]);

  async function act(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      reload();
      onChanged?.();
    } catch (cause) {
      setError(cause instanceof ApiRequestError ? cause.message : "Не удалось выполнить");
    }
  }

  async function add(event: React.FormEvent) {
    event.preventDefault();
    await act(async () => {
      await createPlanItem(patientId, { kind, title, details: details.trim() === "" ? undefined : details });
      setTitle("");
      setDetails("");
    });
  }

  return (
    <div>
      {items === null && <p style={{ color: "#777" }}>Загрузка…</p>}
      {items?.length === 0 && <p style={{ color: "#777", marginTop: 0 }}>Плана пока нет.</p>}
      <ul style={{ listStyle: "none", padding: 0, margin: "0 0 16px", display: "grid", gap: 8 }}>
        {items?.map((item) => (
          <li
            key={item.id}
            style={{
              padding: 12,
              borderRadius: 10,
              border: "1px solid #d0d7de",
              borderLeft: `4px solid ${item.status === "active" ? "#1a7f37" : "#d0d7de"}`,
              background: item.status === "archived" ? "#fafbfc" : "white",
            }}
          >
            <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
              <strong>{item.title}</strong>
              <span style={{ fontSize: 12, color: "#777" }}>
                {KIND[item.kind]} · {STATUS[item.status]}
              </span>
            </div>
            {item.details && <p style={{ margin: "4px 0 0", color: "#333", fontSize: 14 }}>{item.details}</p>}
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              {item.status === "draft" && (
                <button
                  type="button"
                  onClick={() => void act(() => confirmPlanItem(item.id))}
                  style={{ padding: "6px 12px", borderRadius: 8, border: "none", background: "#1f6feb", color: "white", cursor: "pointer" }}
                >
                  Подтвердить
                </button>
              )}
              {item.status !== "archived" && (
                <button
                  type="button"
                  onClick={() => void act(() => archivePlanItem(item.id))}
                  style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid #d0d7de", background: "white", cursor: "pointer" }}
                >
                  В архив
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>

      {error && <p style={{ color: "#b42318", fontSize: 14 }}>{error}</p>}

      <form onSubmit={add} style={{ display: "grid", gap: 6 }}>
        <div style={{ display: "flex", gap: 8 }}>
          <select
            value={kind}
            onChange={(event) => setKind(event.target.value as PlanItem["kind"])}
            style={{ padding: 8, borderRadius: 8, border: "1px solid #d0d7de" }}
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
            style={{ flex: 1, padding: 8, borderRadius: 8, border: "1px solid #d0d7de" }}
          />
        </div>
        <input
          value={details}
          onChange={(event) => setDetails(event.target.value)}
          placeholder="Как принимать, как часто (необязательно)"
          style={{ padding: 8, borderRadius: 8, border: "1px solid #d0d7de" }}
        />
        <button
          type="submit"
          disabled={title.trim() === ""}
          style={{
            justifySelf: "start",
            padding: "8px 14px",
            borderRadius: 8,
            border: "1px solid #d0d7de",
            background: "white",
            cursor: title.trim() === "" ? "default" : "pointer",
            opacity: title.trim() === "" ? 0.5 : 1,
          }}
        >
          Добавить в черновик
        </button>
        <p style={{ color: "#777", fontSize: 13, margin: 0 }}>
          Пациент увидит пункт только после подтверждения.
        </p>
      </form>
    </div>
  );
}
