import { useCallback, useEffect, useState } from "react";
import { AdherenceTable } from "./AdherenceTable";
import { DoctorAppointment } from "./Appointments";
import { DoctorAssessmentForm } from "./DoctorAssessmentForm";
import { PatientFactsPanel } from "./PatientFactsPanel";
import { WatchPanel } from "./WatchPanel";
import { DiaryChart } from "./DiaryChart";
import { MessageThread } from "./MessageThread";
import { PlanPanel } from "./PlanPanel";
import { SIGNAL_STATUS_LABEL, SignalRule, SignalSeverity, sortSignals } from "./SignalsPanel";
import type {
  DiaryEntry,
  DoctorAssessment,
  Message,
  PatientSummary,
  Signal,
  TherapyCard,
} from "../../shared/contracts";
import {
  ApiRequestError,
  fetchPatientAssessments,
  fetchPatientDiary,
  fetchPatientMessages,
  fetchPatientSignals,
  fetchRecommendations,
  sendPatientMessage,
  unbindPatient,
} from "./api";
import { Button, Empty, LoadError, Tabs, loading, track, type Load } from "./ui";

type PatientTab = "overview" | "watch" | "plan" | "messages" | "data";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
}

/** Закрытый сигнал сохраняет только слово: ни полосы, ни тона уровня (signal-semantics.md §6). */
function patientSignalClassName(signal: Pick<Signal, "severity" | "status">): string {
  return signal.status === "closed"
    ? "patient-signal patient-signal--closed"
    : `patient-signal patient-signal--${signal.severity}`;
}

/**
 * Собственные сигналы пациента, компактно и только для чтения: эта вкладка показывает,
 * что дали правила врача и факты пациента, поэтому история остаётся видимой (DESIGN.md §2.4).
 * Она сохраняет слово, форму и полосу 8 / 4 / 0 px, а действия разбора убирает: сигнал
 * берут в разбор на его собственном экране, где и записывают исход разбора (§3.2).
 */
function PatientSignals({ patientId }: { patientId: string }) {
  const [signals, setSignals] = useState<Load<Signal[]>>(loading());

  const reload = useCallback(() => {
    track(setSignals, fetchPatientSignals(patientId).then((response) => response.signals));
  }, [patientId]);

  useEffect(reload, [reload]);

  if (signals.status === "loading") return <p className="notice">Загрузка сигналов…</p>;

  if (signals.status === "failed") {
    return (
      <LoadError onRetry={reload}>
        Не удалось загрузить сигналы пациента. Это не значит, что их не было.
      </LoadError>
    );
  }

  if (signals.data.length === 0) return <Empty>По этому пациенту сигналов не было.</Empty>;

  return (
    <ul className="patient-signals">
      {sortSignals(signals.data).map((signal) => (
        <li key={signal.id} className={patientSignalClassName(signal)}>
          <div className="patient-signal__head">
            <SignalSeverity severity={signal.severity} closed={signal.status === "closed"} />
            <h4 className="patient-signal__title">{signal.title}</h4>
          </div>
          <p className="patient-signal__meta">
            {SIGNAL_STATUS_LABEL[signal.status]} · {formatDate(signal.createdAt)}
            {signal.watchItemId && " · по вашему правилу"}
          </p>
          <p className="patient-signal__detail">{signal.detail}</p>
          <SignalRule signal={signal} />
          {signal.outcome && (
            <p className="hint">
              <em>Результат:</em> {signal.outcome}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

export function PatientDetail({
  patient,
  isPsychiatrist,
  onUnbound,
}: {
  patient: PatientSummary;
  /**
   * Психиатр правит план и назначает приём, терапевт их только видит (SPEC S7, S24, Q50).
   * Специальность — поле врача, а не роль (S2), поэтому решение одно на всю карточку.
   */
  isPsychiatrist: boolean;
  onUnbound: () => void;
}) {
  const [tab, setTab] = useState<PatientTab>("overview");
  const [assessments, setAssessments] = useState<Load<DoctorAssessment[]>>(loading());
  const [entries, setEntries] = useState<Load<DiaryEntry[]>>(loading());
  const [messages, setMessages] = useState<Load<Message[]>>(loading());
  const [recommendations, setRecommendations] = useState<
    Load<{ cards: TherapyCard[]; missing: string[] }>
  >(loading());
  const [unbindStep, setUnbindStep] = useState<"idle" | "confirm" | "busy">("idle");
  const [unbindError, setUnbindError] = useState<string | null>(null);
  const loadAssessments = useCallback(() => {
    track(setAssessments, fetchPatientAssessments(patient.id).then((response) => response.assessments));
  }, [patient.id]);

  const loadEntries = useCallback(() => {
    track(setEntries, fetchPatientDiary(patient.id).then((response) => response.entries));
  }, [patient.id]);

  const loadMessages = useCallback(() => {
    track(setMessages, fetchPatientMessages(patient.id).then((response) => response.messages));
  }, [patient.id]);

  const loadRecommendations = useCallback(() => {
    track(setRecommendations, fetchRecommendations(patient.id));
  }, [patient.id]);

  useEffect(() => {
    loadAssessments();
    loadEntries();
    loadMessages();
    loadRecommendations();
  }, [loadAssessments, loadEntries, loadMessages, loadRecommendations]);

  async function unbind() {
    setUnbindStep("busy");
    setUnbindError(null);
    try {
      await unbindPatient(patient.id);
      onUnbound();
    } catch (cause) {
      setUnbindStep("confirm");
      setUnbindError(
        cause instanceof ApiRequestError ? cause.message : "Не удалось отвязать пациента",
      );
    }
  }

  return (
    <section className="card" aria-label={`Карточка пациента ${patient.name ?? patient.email}`}>
      <div className="patient-card__head">
        <h2 className="patient-card__name">{patient.name ?? patient.email}</h2>
        <p className="patient-card__meta">{patient.email}</p>
        {patient.boundAt && (
          <p className="patient-card__meta">Привязан(а) с {formatDate(patient.boundAt)}</p>
        )}

        {/* Название этапа приходит из файла этапов, а не переводится здесь второй раз. */}
        <p className="patient-card__meta">Этап: {patient.statusLabel.toLowerCase()}</p>
      </div>

      <Tabs<PatientTab>
        label="Разделы карточки пациента"
        value={tab}
        onChange={setTab}
        items={[
          { id: "overview", label: "Обзор" },
          { id: "watch", label: "Наблюдение" },
          { id: "plan", label: "План" },
          { id: "messages", label: "Переписка" },
          { id: "data", label: "Данные" },
        ]}
      />

      {tab === "overview" && (
        <div className="stack">
          <DoctorAppointment patientId={patient.id} canEdit={isPsychiatrist} />

          <div>
            <h3 className="section-title">Приверженность</h3>
            <AdherenceTable patientId={patient.id} />
          </div>

          <div>
            <h3 className="section-title">Варианты терапии</h3>
            {recommendations.status === "loading" && <p className="notice">Загрузка рекомендаций…</p>}
            {recommendations.status === "failed" && (
              <LoadError onRetry={loadRecommendations}>
                Не удалось загрузить рекомендации. Это не значит, что их нет.
              </LoadError>
            )}
            {recommendations.status === "ready" && recommendations.data.cards.length === 0 && (
              <Empty>Рекомендации не построены — нет документов, на которые можно опереться.</Empty>
            )}
            {recommendations.status === "ready" && (
              <>
                {recommendations.data.cards.length > 0 && (
                  <ul className="stack" style={{ gap: 12, margin: 0, padding: 0, listStyle: "none" }}>
                    {recommendations.data.cards.map((card) => (
                      <li key={card.id} style={{ padding: 16, borderRadius: "var(--radius-surface)", border: "1px solid var(--border-divider)" }}>
                        <strong>{card.title}</strong>
                        <p style={{ margin: "8px 0 0", fontSize: 13 }}>
                          <em>Основание:</em> {card.basis}
                        </p>
                        {card.missing.length > 0 && (
                          <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--signal-high)" }}>
                            Не хватает: {card.missing.join("; ")}
                          </p>
                        )}
                        {card.source && (
                          <a
                            href={card.source.url}
                            target="_blank"
                            rel="noreferrer"
                            style={{ display: "inline-block", marginTop: 8, fontSize: 13, color: "var(--link)" }}
                          >
                            Источник
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {recommendations.data.missing.length > 0 && (
                  <div style={{ marginTop: 10, padding: 12, borderRadius: "var(--radius-surface)", background: "var(--surface-signal-high-tint)" }}>
                    <p style={{ margin: 0, fontSize: 14, color: "var(--signal-high)" }}>
                      <strong>Чего не хватает для рекомендаций:</strong>
                    </p>
                    <ul style={{ margin: "6px 0 0", paddingLeft: 20, fontSize: 14, color: "var(--signal-high)" }}>
                      {recommendations.data.missing.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {tab === "watch" && (
        <div className="stack">
          <div>
            <h3 className="section-title">Правила наблюдения</h3>
            <WatchPanel key={status} patientId={patient.id} />
          </div>
          {/*
            * Факты стоят вплотную над сигналами: карточка сигнала называет факт
            * («у пациента отмечено: снижение СКФ») и своё правило, а факт отвечает
            * на другой вопрос — что именно сказал пациент и когда. Порознь они
            * читаются как два разных мира (§2.2, #48).
            */}
          <div>
            <h3 className="section-title">Факты, блокирующие решение</h3>
            <PatientFactsPanel patientId={patient.id} />
          </div>
          <div>
            <h3 className="section-title">Сигналы пациента</h3>
            <PatientSignals patientId={patient.id} />
          </div>
        </div>
      )}

      {tab === "plan" && <PlanPanel patientId={patient.id} canEdit={isPsychiatrist} />}

      {tab === "messages" && (
        <>
          {messages.status === "loading" && <p className="notice">Загрузка переписки…</p>}
          {messages.status === "failed" && (
            <LoadError onRetry={loadMessages}>
              Не удалось загрузить переписку. Это не значит, что сообщений не было.
            </LoadError>
          )}
          {messages.status === "ready" && (
            <MessageThread
              messages={messages.data}
              viewer="doctor"
              placeholder="Ответить пациенту"
              onSend={async (body) => {
                const response = await sendPatientMessage(patient.id, body);
                setMessages((current) =>
                  current.status === "ready"
                    ? { status: "ready", data: [...current.data, response.message] }
                    : current,
                );
              }}
            />
          )}
        </>
      )}

      {tab === "data" && (
        <div className="stack">
          <DoctorAssessmentForm
            patientId={patient.id}
            canFill={isPsychiatrist}
            onSaved={loadAssessments}
          />

          <div>
            <h3 className="section-title">Опросники</h3>
            {assessments.status === "loading" && <p className="notice">Загрузка ответов…</p>}
            {assessments.status === "failed" && (
              <LoadError onRetry={loadAssessments}>
                Не удалось загрузить ответы опросника. Это не значит, что пациент его не проходил.
              </LoadError>
            )}
            {assessments.status === "ready" && assessments.data.length === 0 && (
              <Empty>Пациент ещё не проходил опросник.</Empty>
            )}
            {assessments.status === "ready" && assessments.data.length > 0 && (
              <table className="assessment-table">
                <thead>
                  <tr>
                    <th scope="col">Опросник</th>
                    <th scope="col">Дата</th>
                    <th scope="col">Сумма</th>
                    <th scope="col">Диапазон</th>
                  </tr>
                </thead>
                <tbody>
                  {assessments.data.map((assessment) => (
                    <tr key={assessment.id}>
                      <td>{assessment.instrumentTitle}</td>
                      <td>{formatDate(assessment.submittedAt)}</td>
                      <td>
                        {assessment.total}
                        {assessment.criticalItems.length > 0 && (
                          <span className="assessment-table__critical">критический пункт</span>
                        )}
                      </td>
                      <td>{assessment.band.label}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div>
            <h3 className="section-title">Дневник самочувствия</h3>
            {entries.status === "loading" && <p className="notice">Загрузка записей…</p>}
            {entries.status === "failed" && (
              <LoadError onRetry={loadEntries}>
                Не удалось загрузить дневник. Это не значит, что записей не было.
              </LoadError>
            )}
            {entries.status === "ready" && entries.data.length === 0 && <Empty>Записей пока нет.</Empty>}
            {entries.status === "ready" && entries.data.length > 0 && (
              <DiaryChart entries={entries.data} />
            )}
            {entries.status === "ready" && entries.data.length > 0 && (
              <ul className="diary-log">
                {entries.data.map((entry) => (
                  <li key={entry.id} className="diary-log__entry">
                    <p className="diary-log__line">
                      {formatDate(entry.entryDate)} — {entry.value} / 10
                    </p>
                    {entry.comment && <p className="diary-log__comment">{entry.comment}</p>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      <div className="patient-card__footer">
        {unbindStep === "idle" && (
          <Button className="button--quiet" onClick={() => setUnbindStep("confirm")}>
            Отвязать пациента
          </Button>
        )}
        {unbindStep !== "idle" && (
          <div className="confirm">
            <p className="confirm__question">
              Отвязать пациента? Пациент больше не будет привязан к вам, и новые сигналы по нему
              перестанут к вам приходить.
            </p>
            <div className="row">
              <Button onClick={() => void unbind()} disabled={unbindStep === "busy"}>
                {unbindStep === "busy" ? "Отвязываем…" : "Да, отвязать"}
              </Button>
              <Button onClick={() => setUnbindStep("idle")} disabled={unbindStep === "busy"}>
                Отмена
              </Button>
            </div>
            {unbindError && <p className="notice notice--error">{unbindError}</p>}
          </div>
        )}
      </div>
    </section>
  );
}
