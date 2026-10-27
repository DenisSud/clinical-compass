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
 * Выполнено, пропуск и отсутствие сведений это три разных факта. Слить их в
 * процент значит сказать врачу, что пациент пропустил приёмы, о которых мы вовсе
 * не спрашивали, поэтому каждое состояние остаётся числом, а плитка «нет сведений»
 * получает пустой контур вместо заливки (DESIGN.md §2.5).
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
        /* Причина есть только у дня с пропуском: пропуск без причины невозможен
         * (запись идёт в TodayPlan), поэтому отсутствие причины ничего не прячет, такого дня нет.
         */
        const reasons = item.days.filter((day) => day.state === "skipped" && day.reason);

        return (
          <section key={item.planItemId} className="adherence__item">
            <h4 className="adherence__title">{item.title}</h4>

            {/* Ни числа, ни длины окна в подписи: маршрут считает от даты начала пункта,
             * поэтому «последние 14 дней» было бы утверждением, которое данные выполняют не всегда.
             */}
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
