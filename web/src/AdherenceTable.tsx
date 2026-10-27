import { useEffect, useState } from "react";
import type { AdherenceDay, DoctorAdherence } from "../../shared/contracts";
import { fetchPatientCheckins } from "./api";

const STATE_GLYPH = {
  done: "✓",
  skipped: "✗",
  no_data: "—",
} as const;

const STATE_LABEL = {
  done: "выполнено",
  skipped: "пропущено",
  no_data: "нет сведений",
} as const;

const STATES = ["done", "skipped", "no_data"] as const;

function dayText(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

function dayLabel(day: AdherenceDay): string {
  return `${dayText(day.date)}: ${STATE_LABEL[day.state]}`;
}

function tileTitle(day: AdherenceDay): string {
  return day.state === "skipped" && day.reason ? `${dayLabel(day)} — ${day.reason}` : dayLabel(day);
}

/**
 * Done, skipped and unknown are three different facts. Collapsing them into a
 * percentage would tell the doctor a patient missed doses we simply never asked about,
 * so the count of each state stays a count and the tile for «нет сведений» takes an
 * empty outline instead of a fill (DESIGN.md §2.5).
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
      <p className="notice notice--error">
        Не удалось загрузить приверженность. Это не значит, что пропусков нет — обновите страницу.
      </p>
    );
  }
  if (data === null) return <p className="notice">Загрузка…</p>;
  if (data.items.length === 0) {
    return <p className="notice">В действующем плане пока нет назначений.</p>;
  }

  return (
    <div className="adherence">
      {data.items.map((item) => {
        const counts = { done: item.done, skipped: item.skipped, no_data: item.noData };
        /* A skipped day is the only day that has a reason: a miss without one cannot be
           recorded (TodayPlan), so a missing reason hides nothing — there is no such day. */
        const reasons = item.days.filter((day) => day.state === "skipped" && day.reason);

        return (
          <section key={item.planItemId} className="adherence__item">
            <h4 className="adherence__title">{item.title}</h4>

            {/* No count and no window length in the label: the route returns from the item's
                start date, so «последние 14 дней» would be a claim the data does not always meet. */}
            <div className="adherence__grid">
              {item.days.map((day) => (
                <span
                  key={day.date}
                  className={`adherence-tile adherence-tile--${day.state}`}
                  title={tileTitle(day)}
                >
                  <span aria-hidden="true">{STATE_GLYPH[day.state]}</span>
                  <span className="adherence-tile__state">{dayLabel(day)}</span>
                </span>
              ))}
            </div>

            <p className="adherence__legend">
              {STATES.map((state) => (
                <span key={state} className="adherence__legend-item">
                  <span
                    className={`adherence-tile adherence-tile--${state} adherence-tile--legend`}
                    aria-hidden="true"
                  >
                    {STATE_GLYPH[state]}
                  </span>
                  {STATE_LABEL[state]} {counts[state]}
                </span>
              ))}
            </p>

            {reasons.length > 0 && (
              <div className="adherence__reasons">
                <p className="adherence__reasons-title">Причины пропусков</p>
                <ul className="adherence__reasons-list">
                  {reasons.map((day) => (
                    <li key={day.date}>
                      {dayText(day.date)}: {day.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
