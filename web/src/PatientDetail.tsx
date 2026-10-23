import { useEffect, useState } from "react";
import { AdherenceTable } from "./AdherenceTable";
import { WatchPanel } from "./WatchPanel";
import { MessageThread } from "./MessageThread";
import { PlanPanel } from "./PlanPanel";
import type { DiaryEntry, DoctorAssessment, Message, PatientSummary, TherapyCard } from "../../shared/contracts";
import {
  fetchPatientAssessments,
  fetchPatientDiary,
  fetchPatientMessages,
  fetchRecommendations,
  sendPatientMessage,
  unbindPatient,
} from "./api";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
}

export function PatientDetail({ patient, onUnbound }: { patient: PatientSummary; onUnbound: () => void }) {
  const [assessments, setAssessments] = useState<DoctorAssessment[] | null>(null);
  const [entries, setEntries] = useState<DiaryEntry[] | null>(null);
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [cards, setCards] = useState<TherapyCard[] | null>(null);
  const [missing, setMissing] = useState<string[]>([]);

  useEffect(() => {
    setAssessments(null);
    setEntries(null);
    setLoadFailed(false);
    fetchPatientAssessments(patient.id)
      .then((response) => setAssessments(response.assessments))
      .catch(() => setLoadFailed(true));
    fetchPatientDiary(patient.id)
      .then((response) => setEntries(response.entries))
      .catch(() => setLoadFailed(true));
    fetchPatientMessages(patient.id)
      .then((response) => setMessages(response.messages))
      .catch(() => setLoadFailed(true));
    fetchRecommendations(patient.id)
      .then((response) => {
        setCards(response.cards);
        setMissing(response.missing);
      })
      .catch(() => setCards([]));
  }, [patient.id]);

  return (
    <section style={{ marginTop: 24, padding: 20, border: "1px solid #d0d7de", borderRadius: 12 }}>
      <h2 style={{ fontSize: 16, marginTop: 0 }}>{patient.name ?? patient.email}</h2>
      <p style={{ color: "#555", margin: "4px 0" }}>{patient.email}</p>
      {patient.boundAt && (
        <p style={{ color: "#777", fontSize: 14, marginTop: 0 }}>Привязан(а) с {formatDate(patient.boundAt)}</p>
      )}

      {loadFailed && (
        <p style={{ color: "#b42318", fontSize: 14 }}>
          Не удалось загрузить часть данных. Это не значит, что их нет — обновите страницу.
        </p>
      )}

      <h3 style={{ fontSize: 15, marginTop: 20 }}>Наблюдение</h3>
      <WatchPanel patientId={patient.id} />

      <h3 style={{ fontSize: 15, marginTop: 20 }}>Приверженность</h3>
      <AdherenceTable patientId={patient.id} />

      <h3 style={{ fontSize: 15, marginTop: 20 }}>Варианты терапии</h3>
      {cards === null && <p style={{ color: "#777" }}>Загрузка…</p>}
      {cards?.length === 0 && (
        <p style={{ color: "#555", marginTop: 0 }}>
          Рекомендации не построены — нет документов, на которые можно опереться.
        </p>
      )}
      {cards && cards.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 10 }}>
          {cards.map((card) => (
            <li key={card.id} style={{ padding: 12, borderRadius: 10, border: "1px solid #d0d7de" }}>
              <strong>{card.title}</strong>
              <p style={{ margin: "6px 0 0", fontSize: 14 }}>
                <em>Основание:</em> {card.basis}
              </p>
              {card.missing.length > 0 && (
                <div style={{ marginTop: 6, fontSize: 14, color: "#b54708" }}>
                  Не хватает: {card.missing.join("; ")}
                </div>
              )}
              {card.source && (
                <a
                  href={card.source.url}
                  target="_blank"
                  rel="noreferrer"
                  style={{ fontSize: 13, color: "#1f6feb" }}
                >
                  Источник
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
      {missing.length > 0 && (
        <div style={{ marginTop: 10, padding: 12, borderRadius: 10, background: "#fffaeb" }}>
          <p style={{ margin: 0, fontSize: 14, color: "#b54708" }}>
            <strong>Чего не хватает для рекомендаций:</strong>
          </p>
          <ul style={{ margin: "6px 0 0", paddingLeft: 20, fontSize: 14, color: "#b54708" }}>
            {missing.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}

      <h3 style={{ fontSize: 15, marginTop: 20 }}>Опросник PHQ-9</h3>
      {assessments === null && <p style={{ color: "#777" }}>Загрузка…</p>}
      {assessments?.length === 0 && !loadFailed && <p style={{ color: "#777" }}>Пациент ещё не проходил опросник.</p>}
      {assessments && assessments.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "#777" }}>
              <th style={{ padding: "6px 0", fontWeight: 500 }}>Дата</th>
              <th style={{ fontWeight: 500 }}>Сумма</th>
              <th style={{ fontWeight: 500 }}>Диапазон</th>
            </tr>
          </thead>
          <tbody>
            {assessments.map((assessment) => (
              <tr key={assessment.id} style={{ borderTop: "1px solid #eaeef2" }}>
                <td style={{ padding: "8px 0" }}>{formatDate(assessment.submittedAt)}</td>
                <td>
                  {assessment.total}
                  {assessment.criticalItems.length > 0 && (
                    <span
                      title="Отмечен критический пункт"
                      style={{ marginLeft: 8, color: "#b42318", fontWeight: 600 }}
                    >
                      !
                    </span>
                  )}
                </td>
                <td>{assessment.band.label}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3 style={{ fontSize: 15, marginTop: 24 }}>Дневник самочувствия</h3>
      {entries === null && <p style={{ color: "#777" }}>Загрузка…</p>}
      {entries?.length === 0 && !loadFailed && <p style={{ color: "#777" }}>Записей пока нет.</p>}
      {entries && entries.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 10 }}>
          {entries.map((entry) => (
            <li key={entry.id} style={{ borderTop: "1px solid #eaeef2", paddingTop: 10 }}>
              <strong>{entry.value}</strong>
              <span style={{ color: "#777" }}> / 10 — {formatDate(entry.entryDate)}</span>
              {entry.comment && <p style={{ margin: "4px 0 0", color: "#333" }}>{entry.comment}</p>}
            </li>
          ))}
        </ul>
      )}

      <h3 style={{ fontSize: 15, marginTop: 24 }}>План лечения</h3>
      <PlanPanel patientId={patient.id} />

      <h3 style={{ fontSize: 15, marginTop: 24 }}>Переписка</h3>
      {messages === null ? (
        <p style={{ color: "#777" }}>Загрузка…</p>
      ) : (
        <MessageThread
          messages={messages}
          placeholder="Ответить пациенту"
          onSend={async (body) => {
            await sendPatientMessage(patient.id, body);
            const refreshed = await fetchPatientMessages(patient.id);
            setMessages(refreshed.messages);
          }}
        />
      )}

      <button
        type="button"
        onClick={() => void unbindPatient(patient.id).then(onUnbound)}
        style={{
          marginTop: 24,
          padding: "8px 12px",
          borderRadius: 8,
          border: "1px solid #f0b4b4",
          background: "#fff5f5",
          color: "#b42318",
          cursor: "pointer",
        }}
      >
        Отвязать пациента
      </button>
    </section>
  );
}
