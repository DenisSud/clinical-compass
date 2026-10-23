import { useEffect, useState } from "react";
import type { DiaryEntry, DoctorAssessment, PatientSummary } from "../../shared/contracts";
import { fetchPatientAssessments, fetchPatientDiary, unbindPatient } from "./api";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
}

export function PatientDetail({ patient, onUnbound }: { patient: PatientSummary; onUnbound: () => void }) {
  const [assessments, setAssessments] = useState<DoctorAssessment[] | null>(null);
  const [entries, setEntries] = useState<DiaryEntry[] | null>(null);

  useEffect(() => {
    setAssessments(null);
    setEntries(null);
    fetchPatientAssessments(patient.id)
      .then((response) => setAssessments(response.assessments))
      .catch(() => setAssessments([]));
    fetchPatientDiary(patient.id)
      .then((response) => setEntries(response.entries))
      .catch(() => setEntries([]));
  }, [patient.id]);

  return (
    <section style={{ marginTop: 24, padding: 20, border: "1px solid #d0d7de", borderRadius: 12 }}>
      <h2 style={{ fontSize: 16, marginTop: 0 }}>{patient.name ?? patient.email}</h2>
      <p style={{ color: "#555", margin: "4px 0" }}>{patient.email}</p>
      {patient.boundAt && (
        <p style={{ color: "#777", fontSize: 14, marginTop: 0 }}>Привязан(а) с {formatDate(patient.boundAt)}</p>
      )}

      <h3 style={{ fontSize: 15, marginTop: 20 }}>Опросник PHQ-9</h3>
      {assessments === null && <p style={{ color: "#777" }}>Загрузка…</p>}
      {assessments?.length === 0 && <p style={{ color: "#777" }}>Пациент ещё не проходил опросник.</p>}
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
      {entries?.length === 0 && <p style={{ color: "#777" }}>Записей пока нет.</p>}
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
