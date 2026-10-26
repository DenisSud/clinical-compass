import { useEffect, useState } from "react";
import type { Role } from "../../shared/contracts";
import { ApiRequestError, fetchHealth, signIn, signUp } from "./api";

type Mode = "signin" | "signup";

type Copy = {
  kicker: string;
  title: string;
  sub: string;
  emailLabel: string;
  submit: Record<Mode, string>;
  busy: Record<Mode, string>;
  switchMode: Record<Mode, string>;
  otherRole: string;
  otherRoleLabel: string;
};

const COPY: Record<Role, Copy> = {
  patient: {
    kicker: "Клинический компас",
    title: "Вход",
    sub: "Записывайте самочувствие и оставайтесь на связи с вашим врачом.",
    emailLabel: "Email",
    submit: { signin: "Войти", signup: "Зарегистрироваться" },
    busy: { signin: "Входим…", signup: "Регистрируемся…" },
    switchMode: { signin: "Зарегистрироваться", signup: "У меня уже есть аккаунт" },
    otherRole: "Я врач",
    otherRoleLabel: "Перейти к входу для врача",
  },
  doctor: {
    kicker: "Клинический компас · кабинет врача",
    title: "Вход для врача",
    sub: "Сигналы, наблюдения и решения по вашим пациентам.",
    emailLabel: "Рабочий email",
    submit: { signin: "Войти", signup: "Создать аккаунт врача" },
    busy: { signin: "Входим…", signup: "Создаём аккаунт…" },
    switchMode: { signin: "Создать аккаунт врача", signup: "У меня уже есть аккаунт" },
    otherRole: "Я пациент",
    otherRoleLabel: "Перейти к входу для пациента",
  },
};

/**
 * A failed sign-in says the same thing whether the address is unknown or belongs to
 * the other role: the screen names no account (DESIGN.md §2.5). The role is named by
 * the address; the server still decides who may enter.
 */
function authErrorMessage(cause: unknown, role: Role, mode: Mode): string {
  if (cause instanceof ApiRequestError) {
    if (cause.code === "email_taken" && mode === "signup") {
      return role === "doctor"
        ? "Создать аккаунт врача с этим адресом не удалось. Если аккаунт уже есть, войдите."
        : "Зарегистрироваться с этим адресом не удалось. Если аккаунт уже есть, войдите.";
    }
    if (cause.code === "invalid_credentials") {
      return role === "doctor"
        ? "Войти как врач не удалось. Проверьте рабочий email и пароль. Если вы пациент, вход на другом экране."
        : "Войти не удалось. Проверьте email и пароль. Если вы врач, вход на другом экране.";
    }
    if (cause.code === "invalid_request") {
      return "Проверьте email и пароль: пароль не короче 8 символов.";
    }
  }

  return role === "doctor"
    ? "Сервер не ответил. Попробуйте войти ещё раз."
    : "Не получилось связаться. Попробуйте ещё раз.";
}

/**
 * Two doors, one per role (#55). The address names who enters, so the screen does not
 * offer a role choice: the only way to the other door is the quiet line at the bottom.
 * The frame borrows the source's cover (Lato Black under a thin rule), nothing more
 * (DESIGN.md §2.3).
 */
export function AuthScreen({
  role,
  onSwitchRole,
  onAuthenticated,
}: {
  role: Role;
  onSwitchRole: (role: Role) => void;
  onAuthenticated: () => void;
}) {
  const copy = COPY[role];
  const [mode, setMode] = useState<Mode>("signin");
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

  function switchMode() {
    setMode(mode === "signup" ? "signin" : "signup");
    setError(null);
  }

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
      setError(authErrorMessage(cause, role, mode));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={`auth auth--${role}`}>
      <div className="auth-card">
        <header className="auth-head">
          <p className="auth-kicker">{copy.kicker}</p>
          <h1 className="auth-title">{copy.title}</h1>
          <span className="auth-rule" aria-hidden="true" />
          <p className="auth-sub">{copy.sub}</p>
        </header>

        <form onSubmit={submit} className="auth-form">
          <label className="auth-field">
            <span>{copy.emailLabel}</span>
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

          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}

          <button type="submit" className="auth-submit" disabled={busy}>
            {busy ? copy.busy[mode] : copy.submit[mode]}
          </button>
        </form>

        <button type="button" className="auth-switch" onClick={switchMode}>
          {copy.switchMode[mode]}
        </button>

        <div className="auth-role">
          <button
            type="button"
            className="auth-role__button"
            aria-label={copy.otherRoleLabel}
            onClick={() => onSwitchRole(role === "doctor" ? "patient" : "doctor")}
          >
            {copy.otherRole}
          </button>
        </div>
      </div>

      <p className={serverUp === false ? "auth-status auth-status--down" : "auth-status"}>
        {serverUp === null && "Проверяем связь с сервером…"}
        {serverUp === true && "Сервер на связи"}
        {serverUp === false && "Сервер недоступен — данные не сохранятся"}
      </p>
    </main>
  );
}
