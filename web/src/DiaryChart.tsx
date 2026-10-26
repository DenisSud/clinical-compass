import type { DiaryEntry } from "../../shared/contracts";

/**
 * Дневник врача графиком: ось 1–10, даты, одна линия. Врач видит цифры и динамику,
 * поэтому график живёт только здесь (DESIGN.md §2.2). Никакой интерпретации на нём нет:
 * ни «нормы», ни зон, ни слова «хуже» — только значения, которые записал пациент.
 * Список под графиком остаётся: он же несёт комментарии и читается скринридером.
 */
export function DiaryChart({ entries }: { entries: DiaryEntry[] }) {
  const points = [...entries].sort((a, b) => a.entryDate.localeCompare(b.entryDate));
  if (points.length < 2) return null;

  const W = 640;
  const H = 180;
  const pad = { left: 28, right: 12, top: 12, bottom: 24 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;

  const x = (index: number) => pad.left + (innerW * index) / (points.length - 1);
  const y = (value: number) => pad.top + innerH * (1 - (value - 1) / 9);

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const values = points.map((p) => p.value);
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const day = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });

  return (
    <figure className="diary-chart">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Оценки самочувствия по дням от 1 до 10. Записей: ${points.length}, с ${day(first.entryDate)} по ${day(last.entryDate)}, значения от ${Math.min(...values)} до ${Math.max(...values)}.`}
        preserveAspectRatio="none"
      >
        {[1, 5, 10].map((tick) => (
          <g key={tick}>
            <line className="diary-chart__grid" x1={pad.left} x2={W - pad.right} y1={y(tick)} y2={y(tick)} />
            <text className="diary-chart__tick" x={pad.left - 8} y={y(tick) + 4} textAnchor="end">
              {tick}
            </text>
          </g>
        ))}
        <path className="diary-chart__line" d={line} />
        {points.map((point, i) => (
          <circle key={point.id} className="diary-chart__dot" cx={x(i)} cy={y(point.value)} r={3.5}>
            <title>{`${day(point.entryDate)} — ${point.value} из 10`}</title>
          </circle>
        ))}
        <text className="diary-chart__tick" x={pad.left} y={H - 6}>
          {day(first.entryDate)}
        </text>
        <text className="diary-chart__tick" x={W - pad.right} y={H - 6} textAnchor="end">
          {day(last.entryDate)}
        </text>
      </svg>
    </figure>
  );
}
