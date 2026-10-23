import { useEffect, useState } from "react";
import type { DoctorAdherence } from "../../shared/contracts";
import { fetchPatientCheckins } from "./api";

const STATE_COLOR = {
  done: "#1a7f37",
  skipped: "#d1242f",
  no_data: "#d8dee4",
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
      <p style={{ color: "#b42318", fontSize: 14 }}>
        Не удалось загрузить приверженность. Это не значит, что пропусков нет — обновите страницу.
      </p>
    );
  }
  if (data === null) return <p style={{ color: "#777" }}>Загрузка…</p>;
  if (data.items.length === 0) {
    return <p style={{ color: "#777" }}>В действующем плане пока нет назначений.</p>;
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {data.items.map((item) => (
        <div key={item.planItemId}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 14 }}>
            <strong>{item.title}</strong>
            <span style={{ color: "#555", whiteSpace: "nowrap" }}>
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
                  borderRadius: 3,
                  background: STATE_COLOR[day.state],
                }}
              />
            ))}
          </div>
          {item.days
            .filter((day) => day.reason)
            .slice(-2)
            .map((day) => (
              <p key={day.date} style={{ margin: "4px 0 0", fontSize: 13, color: "#b54708" }}>
                {day.date}: {day.reason}
              </p>
            ))}
        </div>
      ))}
    </div>
  );
}
