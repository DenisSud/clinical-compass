import type { PatientProfile } from "../../shared/contracts";

export function PatientHome({ profile, onSignOut }: { profile: PatientProfile; onSignOut: () => void }) {
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: 32, fontFamily: "system-ui, sans-serif" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h1 style={{ fontSize: 22 }}>Моя карточка</h1>
        <button type="button" onClick={onSignOut} style={{ background: "none", border: "none", color: "#1f6feb", cursor: "pointer" }}>
          Выйти
        </button>
      </header>

      <p style={{ color: "#555" }}>{profile.email}</p>

      <h2 style={{ fontSize: 16, marginTop: 32 }}>Ведущий врач</h2>
      {profile.doctor ? (
        <p>
          {profile.doctor.name ?? profile.doctor.email}
          {profile.boundAt && <span style={{ color: "#777" }}> — с {profile.boundAt.slice(0, 10)}</span>}
        </p>
      ) : (
        <p style={{ color: "#555" }}>Вы пока не привязаны к врачу.</p>
      )}
    </main>
  );
}
