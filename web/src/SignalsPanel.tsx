import { useState } from "react";
import type { DoctorSignal, Signal, SignalRuleSource } from "../../shared/contracts";
import { ApiRequestError, closeSignal, takeSignal } from "./api";
import { Button, Empty, LoadError, type Load } from "./ui";

/**
 * Подписи уровней это значения, а не фразы: одно семейство, равная длина, читается
 * словом и иконкой (signal-semantics.md #32 §1.1, §7.11).
 */
export const SIGNAL_SEVERITY_LABEL: Record<Signal["severity"], string> = {
  critical: "критично",
  high: "важно",
  medium: "к сведению",
};

/**
 * Форма это второй канал после слова (#32 §1.1, §4.3): залитый треугольник для
 * критичного, контурный треугольник для высокого, контурный круг для среднего. Она
 * обязана нести уровень без цвета: в оттенках серого, при дейтеранопии и в forced-colors.
 */
function SeverityMark({ severity }: { severity: Signal["severity"] }) {
  const filled = severity === "critical";
  const glyph = filled ? "signal__mark-cut" : "signal__mark-glyph";

  return (
    <svg
      className="signal__mark"
      viewBox="0 0 16 16"
      width="16"
      height="16"
      aria-hidden="true"
      focusable="false"
    >
      {severity === "medium" ? (
        <>
          <circle cx="8" cy="8" r="6.6" className="signal__mark-outline" />
          <rect x="7.1" y="4.2" width="1.8" height="5" className={glyph} />
          <circle cx="8" cy="11.3" r="0.9" className={glyph} />
        </>
      ) : (
        <>
          <path
            d="M8 2.4 14.2 13.6H1.8Z"
            className={filled ? "signal__mark-fill" : "signal__mark-outline"}
          />
          <rect x="7.1" y="5.8" width="1.8" height="4.4" className={glyph} />
          <circle cx="8" cy="11.9" r="0.9" className={glyph} />
        </>
      )}
    </svg>
  );
}

/**
 * Тяжесть владеет формой карточки; закрытый сигнал снимает каждый акцент и оставляет
 * только слово (#32 §6).
 */
export function signalClassName(signal: Pick<Signal, "severity" | "status">): string {
  return signal.status === "closed" ? "signal signal--closed" : `signal signal--${signal.severity}`;
}

/** Слово плюс форма: два канала, которые выживают в оттенках серого и в forced-colors. */
export function SignalSeverity({
  severity,
  closed = false,
}: {
  severity: Signal["severity"];
  closed?: boolean;
}) {
  return (
    <span className="signal__severity">
      {!closed && <SeverityMark severity={severity} />}
      {SIGNAL_SEVERITY_LABEL[severity]}
    </span>
  );
}

export const SIGNAL_STATUS_LABEL: Record<Signal["status"], string> = {
  saved: "новый",
  in_review: "в разборе",
  closed: "закрыт",
};

const SEVERITY_RANK: Record<Signal["severity"], number> = { critical: 0, high: 1, medium: 2 };

const RULE_ORIGIN: Record<SignalRuleSource["kind"], string> = {
  guideline: "КР",
  ohlp: "ОХЛП",
  ours: "наше правило",
};

type RuleDescription = {
  title: string;
  origin: string;
  ref: string;
  placeholder: boolean;
};

/**
 * Какое правило подняло карточку и откуда оно. Заглушка говорит об этом словами,
 * поэтому наше временное правило никогда не читается как взятое из рекомендаций.
 * У пациента маршрута сигналов нет вообще (DESIGN.md §2.2).
 */
function describeRule(
  signal: Pick<Signal, "ruleId" | "ruleTitle" | "ruleSource">,
): RuleDescription | null {
  if (!signal.ruleId || !signal.ruleTitle || !signal.ruleSource) return null;

  const source = signal.ruleSource;
  const placeholder = source.status === "placeholder";

  return {
    title: signal.ruleTitle,
    origin: placeholder ? "наше правило, источник ещё не подтверждён" : RULE_ORIGIN[source.kind],
    ref: source.ref,
    placeholder,
  };
}

/** Правило одной фразой: карточке только для чтения в `PatientDetail` негде разместить подписи. */
export function SignalRule({
  signal,
}: {
  signal: Pick<Signal, "ruleId" | "ruleTitle" | "ruleSource">;
}) {
  const rule = describeRule(signal);
  if (!rule) return null;

  // A placeholder already names itself as ours; a confirmed rule names its kind after «источник:».
  const sourceLabel = rule.placeholder ? rule.origin : `источник: ${rule.origin}`;

  return (
    <p className={rule.placeholder ? "signal__source signal__source--placeholder" : "signal__source"}>
      Правило «{rule.title}» · {sourceLabel}
      <span className="signal__source-ref" title="Где лежит источник правила">
        {" "}
        {rule.ref}
      </span>
    </p>
  );
}

/**
 * Та же пара панелью, где обе подписи выписаны (_8): в этом списке правило
 * и его источник читаются как два отдельных факта, а панель не даёт моно-пути
 * соревноваться с названием. Она есть у каждого уровня, у «к сведению» тоже.
 */
export function SignalRulePanel({
  signal,
}: {
  signal: Pick<Signal, "ruleId" | "ruleTitle" | "ruleSource">;
}) {
  const rule = describeRule(signal);
  if (!rule) return null;

  return (
    <div className="signal__rule">
      <p className="signal__rule-line">
        <span className="signal__rule-label">Правило:</span> {rule.title}
      </p>
      <p
        className={
          rule.placeholder ? "signal__rule-line signal__rule-line--placeholder" : "signal__rule-line"
        }
      >
        <span className="signal__rule-label">Источник:</span> {rule.origin}
        <span className="signal__source-ref" title="Где лежит источник правила">
          {" "}
          {rule.ref}
        </span>
      </p>
    </div>
  );
}

/** Сначала тяжесть, потом новизна: порядок, в котором читает врач, а не в котором прислал сервер (§3.7). */
export function sortSignals<T extends Signal>(signals: T[]): T[] {
  return [...signals].sort(
    (left, right) =>
      SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity] ||
      right.createdAt.localeCompare(left.createdAt),
  );
}

/**
 * signal-semantics.md §3: не больше трёх карточек одного уровня на экране, дальше
 * остальное складывается в «Ещё N». Это число из исследования, а не выбор стиля.
 */
export const SIGNALS_PER_LEVEL = 3;

const SEVERITY_ORDER: Signal["severity"][] = ["critical", "high", "medium"];

export type SeveritySection<T extends Signal> = {
  level: Signal["severity"];
  visible: T[];
  folded: T[];
};

/**
 * Критичные не складываются никогда (#35): DESIGN.md §2.1 ставит пропущенный сигнал выше
 * компактности, а критический сигнал за закрытым «Ещё N» это ровно тот пропуск, который
 * этот экран существует предотвращать. Остальные уровни складываются после трёх.
 */
export function sectionBySeverity<T extends Signal>(sorted: T[]): SeveritySection<T>[] {
  return SEVERITY_ORDER.flatMap((level) => {
    const items = sorted.filter((signal) => signal.severity === level);
    if (items.length === 0) return [];
    const keep = level === "critical" ? items.length : SIGNALS_PER_LEVEL;
    return [{ level, visible: items.slice(0, keep), folded: items.slice(keep) }];
  });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

/**
 * Управляется из DoctorHome, чтобы число открытых в шапке и список на экране
 * не могли разойтись. Обновления сигналов приходят с сервера и заменяют карточку
 * на месте, поэтому врач не теряет своё место (§3.2, §5.6).
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
      <li key={signal.id} className={signalClassName(signal)}>
        <div className="signal__head">
          <SignalSeverity severity={signal.severity} closed={signal.status === "closed"} />
          <span className="signal__status">{SIGNAL_STATUS_LABEL[signal.status]}</span>
        </div>
        <h3 className="signal__title">{signal.title}</h3>
        <p className="signal__meta">
          {signal.patient?.name ?? signal.patient?.email} · {formatDate(signal.createdAt)}
          {signal.watchItemId && " · по вашему правилу"}
        </p>
        <p className="signal__detail">{signal.detail}</p>
        <SignalRulePanel signal={signal} />

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
      {open.length > 0 && (
        <div className="signal-groups">
          {sectionBySeverity(open).map((section) => {
            const level = SIGNAL_SEVERITY_LABEL[section.level];
            const count = section.visible.length + section.folded.length;

            return (
              <section className="signal-group" key={section.level}>
                {/*
                 * Только слово и число: тон уровня живёт на карточке, поэтому заголовок группы
                 * никогда не перекричит критическую карточку, которую открывает (DESIGN.md
                 * §2.3, §3.6).
                 */}
                <h2 className="signal-group__head">
                  {level.charAt(0).toUpperCase() + level.slice(1)}{" "}
                  <span className="signal-group__count">· {count}</span>
                </h2>

                <ul className="signal-list">{section.visible.map(renderCard)}</ul>

                {section.folded.length > 0 && (
                  <details className={`signal-more signal-more--${section.level}`}>
                    <summary>
                      <SeverityMark severity={section.level} />Ещё {section.folded.length}:{" "}
                      {SIGNAL_SEVERITY_LABEL[section.level]}
                    </summary>
                    <ul className="signal-list">{section.folded.map(renderCard)}</ul>
                  </details>
                )}
              </section>
            );
          })}
        </div>
      )}

      {closed.length > 0 && (
        <details className="closed-group">
          <summary>Закрытые ({closed.length})</summary>
          <ul className="signal-list">{closed.map(renderCard)}</ul>
        </details>
      )}
    </section>
  );
}
