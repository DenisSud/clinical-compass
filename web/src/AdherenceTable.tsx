import { useEffect, useState } from "react";
import type { DoctorAdherence } from "../../shared/contracts";
import { fetchPatientCheckins } from "./api";

const STATE_COLOR = {
  done: "var(--signal-done)",
  skipped: "var(--signal-critical)",
  no_data: "var(--border-divider)",
} as const;

const STATE_LABEL = {
  done: "выполнено",
  skipped: "пропущено",
  no_data: "нет сведений",
} as const;

/**
 * Done, skipped and unknown are three different facts. Collapsing them into a
 * percentage would tell the doctor a patient missed doses we simply never asked about.
 */
export function AdherenceTable({ patientId }: { patientId: string }) {
  const [data, setData] = useState<DoctorAdherence | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
    fetchPatientCheckins(patientId)
      .then(setData)
      .catch(() => setFailed(true));
  }, [patientId]);

  if (failed) {
    return (
      <p style={{ color: "var(--signal-critical)", fontSize: 14 }}>
        Не удалось загрузить приверженность. Это не значит, что пропусков нет — обновите страницу.
      </p>
    );
  }
  if (data === null) return <p style={{ color: "var(--text-muted)" }}>Загрузка…</p>;
  if (data.items.length === 0) {
    return <p style={{ color: "var(--text-muted)" }}>В действующем плане пока нет назначений.</p>;
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {data.items.map((item) => (
        <div key={item.planItemId}>
          <div className="row" style={{ justifyContent: "space-between", fontSize: 14 }}>
            <strong>{item.title}</strong>
            <span style={{ color: "var(--text-muted)", whiteSpace: "nowrap" }}>
              выполнено {item.done} · пропущено {item.skipped} · нет сведений {item.noData}
            </span>
          </div>
          <div style={{ display: "flex", gap: 3, marginTop: 6 }} aria-label={`${item.title}: приверженность`}>
            {item.days.map((day) => (
              <span
                key={day.date}
                title={`${day.date}: ${STATE_LABEL[day.state]}${day.reason ? ` — ${day.reason}` : ""}`}
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: "var(--radius-surface)",
                  background: STATE_COLOR[day.state],
                }}
              />
            ))}
          </div>
          {item.days
            .filter((day) => day.reason)
            .slice(-2)
            .map((day) => (
              <p key={day.date} style={{ margin: "4px 0 0", fontSize: 13, color: "var(--signal-high)" }}>
                {day.date}: {day.reason}
              </p>
            ))}
        </div>
      ))}
    </div>
  );
}
