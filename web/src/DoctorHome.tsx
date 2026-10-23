import { useCallback, useEffect, useState } from "react";
import type { DoctorProfile, LinkCodeResponse, PatientSummary } from "../../shared/contracts";
import { fetchLinkCode, fetchPatients, rotateLinkCode } from "./api";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

export function DoctorHome({ profile, onSignOut }: { profile: DoctorProfile; onSignOut: () => void }) {
  const [patients, setPatients] = useState<PatientSummary[] | null>(null);
  const [linkCode, setLinkCode] = useState<LinkCodeResponse | null>(null);

  const load = useCallback(() => {
    fetchPatients()
      .then((response) => setPatients(response.patients))
      .catch(() => setPatients([]));
    fetchLinkCode()
      .then(setLinkCode)
      .catch(() => setLinkCode(null));
  }, []);

  useEffect(load, [load]);

  async function rotate() {
    setLinkCode(await rotateLinkCode());
  }

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: 32, fontFamily: "system-ui, sans-serif" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h1 style={{ fontSize: 22 }}>Кабинет врача</h1>
        <button type="button" onClick={onSignOut} style={{ background: "none", border: "none", color: "#1f6feb", cursor: "pointer" }}>
          Выйти
        </button>
      </header>

      <p style={{ color: "#555" }}>{profile.email}</p>

      <section style={{ marginTop: 32, padding: 20, border: "1px solid #d0d7de", borderRadius: 12 }}>
        <h2 style={{ fontSize: 16, margin: 0 }}>Код привязки</h2>
        <p style={{ color: "#555", marginTop: 4, fontSize: 14 }}>
          Пациент вводит этот код у себя, чтобы привязаться к вам.
        </p>
        {linkCode ? (
          <>
            <p style={{ fontFamily: "ui-monospace, monospace", fontSize: 32, letterSpacing: 6, margin: "12px 0" }}>
              {linkCode.code}
            </p>
            <p style={{ color: "#777", fontSize: 14, marginTop: 0 }}>Действует до {formatDate(linkCode.expiresAt)}</p>
          </>
        ) : (
          <p style={{ color: "#777" }}>Код не получен</p>
        )}
        <button
          type="button"
          onClick={() => void rotate()}
          style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #d0d7de", background: "white", cursor: "pointer" }}
        >
          Перевыпустить код
        </button>
      </section>

      <h2 style={{ fontSize: 16, marginTop: 32 }}>Мои пациенты</h2>
      {patients === null && <p>Загрузка…</p>}
      {patients?.length === 0 && <p style={{ color: "#555" }}>Пока никого.</p>}
      {patients && patients.length > 0 && (
        <ul style={{ paddingLeft: 18 }}>
          {patients.map((patient) => (
            <li key={patient.id} style={{ marginBottom: 4 }}>
              {patient.name ?? patient.email}
              {patient.boundAt && <span style={{ color: "#777" }}> — с {formatDate(patient.boundAt)}</span>}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
