import { useEffect, useState } from "react";
import type { DoctorProfile, PatientSummary } from "../../shared/contracts";
import { fetchPatients } from "./api";

export function DoctorHome({ profile, onSignOut }: { profile: DoctorProfile; onSignOut: () => void }) {
  const [patients, setPatients] = useState<PatientSummary[] | null>(null);

  useEffect(() => {
    fetchPatients()
      .then((response) => setPatients(response.patients))
      .catch(() => setPatients([]));
  }, []);

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: 32, fontFamily: "system-ui, sans-serif" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h1 style={{ fontSize: 22 }}>Кабинет врача</h1>
        <button type="button" onClick={onSignOut} style={{ background: "none", border: "none", color: "#1f6feb", cursor: "pointer" }}>
          Выйти
        </button>
      </header>

      <p style={{ color: "#555" }}>{profile.email}</p>

      <h2 style={{ fontSize: 16, marginTop: 32 }}>Мои пациенты</h2>
      {patients === null && <p>Загрузка…</p>}
      {patients?.length === 0 && (
        <p style={{ color: "#555" }}>Пока никого. Передайте пациенту код привязки, когда он появится.</p>
      )}
      {patients && patients.length > 0 && (
        <ul style={{ paddingLeft: 18 }}>
          {patients.map((patient) => (
            <li key={patient.id}>
              {patient.name ?? patient.email}
              {patient.boundAt && <span style={{ color: "#777" }}> — с {patient.boundAt.slice(0, 10)}</span>}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
