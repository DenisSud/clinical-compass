import { useCallback, useEffect, useState } from "react";
import type { DoctorProfile, BindingCodeResponse, PatientSummary } from "../../shared/contracts";
import { fetchBindingCode, fetchPatients, rotateBindingCode, unbindPatient } from "./api";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

export function DoctorHome({ profile, onSignOut }: { profile: DoctorProfile; onSignOut: () => void }) {
  const [patients, setPatients] = useState<PatientSummary[] | null>(null);
  const [bindingCode, setLinkCode] = useState<BindingCodeResponse | null>(null);
  const [selected, setSelected] = useState<PatientSummary | null>(null);

  const load = useCallback(() => {
    fetchPatients()
      .then((response) => setPatients(response.patients))
      .catch(() => setPatients([]));
    fetchBindingCode()
      .then(setLinkCode)
      .catch(() => setLinkCode(null));
  }, []);

  useEffect(load, [load]);

  async function rotate() {
    setLinkCode(await rotateBindingCode());
  }

  async function unbind(patient: PatientSummary) {
    await unbindPatient(patient.id);
    setSelected(null);
    load();
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
        {bindingCode ? (
          <>
            <p style={{ fontFamily: "ui-monospace, monospace", fontSize: 32, letterSpacing: 6, margin: "12px 0" }}>
              {bindingCode.code}
            </p>
            <p style={{ color: "#777", fontSize: 14, marginTop: 0 }}>Действует до {formatDate(bindingCode.expiresAt)}</p>
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
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
          {patients.map((patient) => (
            <li key={patient.id}>
              <button
                type="button"
                onClick={() => setSelected(patient)}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "12px 14px",
                  borderRadius: 10,
                  border: "1px solid " + (selected?.id === patient.id ? "#1f6feb" : "#d0d7de"),
                  background: "white",
                  cursor: "pointer",
                  fontSize: 15,
                }}
              >
                {patient.name ?? patient.email}
                {patient.boundAt && <span style={{ color: "#777" }}> — с {formatDate(patient.boundAt)}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}

      {selected && (
        <section style={{ marginTop: 24, padding: 20, border: "1px solid #d0d7de", borderRadius: 12 }}>
          <h2 style={{ fontSize: 16, marginTop: 0 }}>{selected.name ?? selected.email}</h2>
          <p style={{ color: "#555", margin: "4px 0" }}>{selected.email}</p>
          {selected.boundAt && (
            <p style={{ color: "#777", fontSize: 14, marginTop: 0 }}>Привязан(а) с {formatDate(selected.boundAt)}</p>
          )}
          <button
            type="button"
            onClick={() => void unbind(selected)}
            style={{
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
      )}
    </main>
  );
}
