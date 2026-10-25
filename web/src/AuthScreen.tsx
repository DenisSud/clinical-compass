import { useEffect, useState } from "react";
import type { Role } from "../../shared/contracts";
import { ApiRequestError, fetchHealth, signIn, signUp } from "./api";

const ROLE_LABEL: Record<Role, string> = { patient: "Пациент", doctor: "Врач" };

/**
 * Первый экран, который видит жюри. Здесь работает ровно один брендовый приём
 * источника: заголовок Lato Black под тонкой линейкой, как на обложке презентации
 * спонсора (slide 1, кегль 22.6 pt, линейка 3 pt). Ничего декоративного сверх
 * этого: DESIGN.md §2.3.
 */
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
    <main className="auth">
      <div className="auth-card">
        <header className="auth-head">
          <h1 className="auth-title">Клинический компас</h1>
          <span className="auth-rule" aria-hidden="true" />
          <p className="auth-sub">Поддержка принятия решений при тревоге и депрессии</p>
        </header>

        <div role="tablist" aria-label="Роль" className="auth-tabs">
          {(["patient", "doctor"] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={role === option}
              onClick={() => setRole(option)}
              className={role === option ? "auth-tab auth-tab--on" : "auth-tab"}
            >
              {ROLE_LABEL[option]}
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="auth-form">
          <label className="auth-field">
            <span>Email</span>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>

          <label className="auth-field">
            <span>Пароль</span>
            <input
              type="password"
              required
              minLength={8}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>

          {error && <p className="auth-error">{error}</p>}

          <button type="submit" className="auth-submit" disabled={busy}>
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
          className="auth-switch"
          onClick={() => setMode(mode === "signup" ? "signin" : "signup")}
        >
          {mode === "signup" ? "У меня уже есть аккаунт" : "Создать аккаунт"}
        </button>
      </div>

      <p className={serverUp === false ? "auth-status auth-status--down" : "auth-status"}>
        {serverUp === null && "Проверяем связь с сервером…"}
        {serverUp === true && "Сервер на связи"}
        {serverUp === false && "Сервер недоступен — данные не сохранятся"}
      </p>
    </main>
  );
}
