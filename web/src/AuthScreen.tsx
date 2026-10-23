import { useEffect, useState } from "react";
import type { Role } from "../../shared/contracts";
import { ApiRequestError, fetchHealth, signIn, signUp } from "./api";

const ROLE_LABEL: Record<Role, string> = { patient: "Пациент", doctor: "Врач" };

export function AuthScreen({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [role, setRole] = useState<Role>("patient");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [serverUp, setServerUp] = useState<boolean | null>(null);

  useEffect(() => {
    fetchHealth()
      .then(() => setServerUp(true))
      .catch(() => setServerUp(false));
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const credentials = { email, password };
      if (mode === "signup") await signUp(role, credentials);
      else await signIn(role, credentials);
      onAuthenticated();
    } catch (cause) {
      setError(cause instanceof ApiRequestError ? cause.message : "Что-то пошло не так");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 420, margin: "0 auto", padding: 32, fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 24, marginBottom: 4 }}>Клинический компас</h1>
      <p style={{ color: "#555", marginTop: 0 }}>Поддержка принятия решений при тревоге и депрессии</p>

      <div role="tablist" style={{ display: "flex", gap: 8, margin: "24px 0 12px" }}>
        {(["patient", "doctor"] as const).map((option) => (
          <button
            key={option}
            type="button"
            role="tab"
            aria-selected={role === option}
            onClick={() => setRole(option)}
            style={{
              flex: 1,
              padding: "8px 12px",
              borderRadius: 8,
              border: "1px solid " + (role === option ? "#1f6feb" : "#d0d7de"),
              background: role === option ? "#1f6feb" : "white",
              color: role === option ? "white" : "#24292f",
              cursor: "pointer",
            }}
          >
            {ROLE_LABEL[option]}
          </button>
        ))}
      </div>

      <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
        <label style={{ display: "grid", gap: 4 }}>
          <span style={{ fontSize: 14 }}>Email</span>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #d0d7de" }}
          />
        </label>

        <label style={{ display: "grid", gap: 4 }}>
          <span style={{ fontSize: 14 }}>Пароль</span>
          <input
            type="password"
            required
            minLength={8}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #d0d7de" }}
          />
        </label>

        {error && <p style={{ color: "#b42318", margin: 0, fontSize: 14 }}>{error}</p>}

        <button
          type="submit"
          disabled={busy}
          style={{
            padding: "10px 12px",
            borderRadius: 8,
            border: "none",
            background: "#1f6feb",
            color: "white",
            fontSize: 15,
            cursor: busy ? "progress" : "pointer",
          }}
        >
          {busy
            ? mode === "signup"
              ? "Регистрируемся…"
              : "Входим…"
            : mode === "signup"
              ? "Зарегистрироваться"
              : "Войти"}
        </button>
      </form>

      <button
        type="button"
        onClick={() => setMode(mode === "signup" ? "signin" : "signup")}
        style={{ marginTop: 16, background: "none", border: "none", color: "#1f6feb", cursor: "pointer", padding: 0 }}
      >
        {mode === "signup" ? "У меня уже есть аккаунт" : "Создать аккаунт"}
      </button>

      <p style={{ marginTop: 32, fontSize: 13, color: serverUp === false ? "#b42318" : "#777" }}>
        {serverUp === null && "Проверяем связь с сервером…"}
        {serverUp === true && "Сервер на связи"}
        {serverUp === false && "Сервер недоступен — данные не сохранятся"}
      </p>
    </main>
  );
}
