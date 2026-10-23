import { useCallback, useEffect, useRef, useState } from "react";
import type { DoctorProfile, BindingCodeResponse, PatientSummary } from "../../shared/contracts";
import { fetchBindingCode, fetchPatients, rotateBindingCode } from "./api";
import { PatientDetail } from "./PatientDetail";
import { SignalsPanel } from "./SignalsPanel";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

export function DoctorHome({ profile, onSignOut }: { profile: DoctorProfile; onSignOut: () => void }) {
  const [patients, setPatients] = useState<PatientSummary[] | null>(null);
  const [bindingCode, setLinkCode] = useState<BindingCodeResponse | null>(null);
  const [selected, setSelected] = useState<PatientSummary | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const cardRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(() => {
    setLoadFailed(false);
    fetchPatients()
      .then((response) => setPatients(response.patients))
      .catch(() => setLoadFailed(true));
    fetchBindingCode()
      .then(setLinkCode)
      .catch(() => setLinkCode(null));
  }, []);

  useEffect(load, [load]);

  useEffect(() => {
    if (selected) cardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [selected]);

  async function rotate() {
    setLinkCode(await rotateBindingCode());
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

      <SignalsPanel onChanged={load} />

      <h2 style={{ fontSize: 16, marginTop: 32 }}>Мои пациенты</h2>
      {patients === null && <p>Загрузка…</p>}
      {loadFailed && (
        <p style={{ color: "#b42318", fontSize: 14 }}>
          Не удалось загрузить список пациентов — обновите страницу.
        </p>
      )}
      {patients?.length === 0 && !loadFailed && <p style={{ color: "#555" }}>Пока никого.</p>}
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

      <div ref={cardRef} />
      {selected && (
        <PatientDetail
          patient={selected}
          onUnbound={() => {
            setSelected(null);
            load();
          }}
        />
      )}

    </main>
  );
}
