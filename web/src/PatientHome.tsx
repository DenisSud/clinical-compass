import { useState } from "react";
import type { PatientProfile } from "../../shared/contracts";
import { ApiError, bindToDoctor } from "./api";

export function PatientHome({
  profile,
  onSignOut,
  onChanged,
}: {
  profile: PatientProfile;
  onSignOut: () => void;
  onChanged: () => void;
}) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await bindToDoctor(code);
      setCode("");
      onChanged();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Не удалось привязаться");
    } finally {
      setBusy(false);
    }
  }

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
          {profile.boundAt && (
            <span style={{ color: "#777" }}>
              {" "}
              — с {new Date(profile.boundAt).toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}
            </span>
          )}
        </p>
      ) : (
        <>
          <p style={{ color: "#555" }}>Вы пока не привязаны к врачу. Введите код, который вам передал врач.</p>
          <form onSubmit={submit} style={{ display: "flex", gap: 8, alignItems: "start" }}>
            <input
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="Код привязки"
              required
              style={{
                padding: "10px 12px",
                borderRadius: 8,
                border: "1px solid #d0d7de",
                fontFamily: "ui-monospace, monospace",
                letterSpacing: 2,
                textTransform: "uppercase",
                width: 180,
              }}
            />
            <button
              type="submit"
              disabled={busy}
              style={{
                padding: "10px 16px",
                borderRadius: 8,
                border: "none",
                background: "#1f6feb",
                color: "white",
                cursor: busy ? "progress" : "pointer",
              }}
            >
              Привязаться
            </button>
          </form>
          {error && <p style={{ color: "#b42318", fontSize: 14 }}>{error}</p>}
        </>
      )}
    </main>
  );
}
