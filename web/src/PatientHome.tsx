import { useCallback, useEffect, useState } from "react";
import type { DiaryEntry, Message, PatientAssessment, PatientProfile, PlanItem } from "../../shared/contracts";
import {
  ApiRequestError,
  bindToDoctor,
  fetchMyAssessments,
  fetchMyDiary,
  fetchMyMessages,
  fetchMyPlan,
  sendMessage,
} from "./api";
import { DiaryForm } from "./DiaryForm";
import { MessageThread } from "./MessageThread";
import { Phq9Form } from "./Phq9Form";

const CARD = { marginTop: 24, padding: 20, border: "1px solid #d0d7de", borderRadius: 12 } as const;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
}

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
  const [assessments, setAssessments] = useState<PatientAssessment[] | null>(null);
  const [entries, setEntries] = useState<DiaryEntry[] | null>(null);
  const [openForm, setOpenForm] = useState<"phq9" | null>(null);
  const [plan, setPlan] = useState<PlanItem[] | null>(null);
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [nextAllowedAt, setNextAllowedAt] = useState<string | null>(null);

  const reload = useCallback(() => {
    fetchMyAssessments()
      .then((response) => {
        setAssessments(response.assessments);
        setNextAllowedAt(response.nextAllowedAt);
      })
      .catch(() => setAssessments([]));
    fetchMyDiary()
      .then((response) => setEntries(response.entries))
      .catch(() => setEntries([]));
    fetchMyPlan()
      .then((response) => setPlan(response.items))
      .catch(() => setPlan([]));
    fetchMyMessages()
      .then((response) => setMessages(response.messages))
      .catch(() => setMessages([]));
  }, []);

  useEffect(reload, [reload]);

  async function bind(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await bindToDoctor(code);
      setCode("");
      onChanged();
    } catch (cause) {
      setError(cause instanceof ApiRequestError ? cause.message : "Не удалось привязаться");
    } finally {
      setBusy(false);
    }
  }

  const today = new Date().toLocaleDateString("sv-SE");
  const todayEntry = entries?.find((entry) => entry.entryDate === today);
  const weeklyWait = nextAllowedAt !== null && new Date(nextAllowedAt).getTime() > Date.now();

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
          <form onSubmit={bind} style={{ display: "flex", gap: 8, alignItems: "start" }}>
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

      <section style={CARD}>
        <h2 style={{ fontSize: 16, marginTop: 0 }}>План лечения</h2>
        {plan === null && <p style={{ color: "#777" }}>Загрузка…</p>}
        {plan?.length === 0 && (
          <p style={{ color: "#777", marginTop: 0 }}>
            Врач пока не добавил план. Пункты появляются здесь после того, как врач их подтвердит.
          </p>
        )}
        {plan && plan.length > 0 && (
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 10 }}>
            {plan.map((item) => (
              <li key={item.id} style={{ borderLeft: "3px solid #1a7f37", paddingLeft: 12 }}>
                <strong>{item.title}</strong>
                {item.details && <p style={{ margin: "2px 0 0", color: "#333" }}>{item.details}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section style={CARD}>
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Вопрос врачу</h2>
        {messages === null ? (
          <p style={{ color: "#777" }}>Загрузка…</p>
        ) : (
          <MessageThread
            messages={messages}
            placeholder="Например: стало хуже спать, что делать?"
            onSend={async (body) => {
              await sendMessage(body);
              const refreshed = await fetchMyMessages();
              setMessages(refreshed.messages);
            }}
          />
        )}
        {!profile.doctor && (
          <p style={{ color: "#777", fontSize: 13, marginBottom: 0 }}>
            Пока вы не привязаны к врачу, сообщения видит только ваша карточка.
          </p>
        )}
      </section>

      <section style={CARD}>
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Самочувствие</h2>
        {todayEntry ? (
          <p style={{ marginTop: 0 }}>
            Сегодня отмечено: <strong>{todayEntry.value}</strong> / 10
            {todayEntry.comment && <span style={{ color: "#555" }}> — {todayEntry.comment}</span>}
            <br />
            <span style={{ color: "#777", fontSize: 14 }}>Следующая запись — завтра.</span>
          </p>
        ) : (
          <DiaryForm onSaved={reload} />
        )}
        {entries && entries.length > 0 && (
          <ul style={{ listStyle: "none", padding: 0, margin: "20px 0 0", display: "grid", gap: 10 }}>
            {entries.map((entry) => (
              <li key={entry.id} style={{ borderTop: "1px solid #eaeef2", paddingTop: 10 }}>
                <strong>{entry.value}</strong>
                <span style={{ color: "#777" }}> / 10 — {formatDate(entry.entryDate)}</span>
                {entry.comment && <p style={{ margin: "4px 0 0", color: "#333" }}>{entry.comment}</p>}
              </li>
            ))}
          </ul>
        )}
        {entries?.length === 0 && <p style={{ color: "#777", marginBottom: 0 }}>Записей пока нет.</p>}
      </section>

      <section style={CARD}>
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Опросник PHQ-9</h2>
        {openForm === "phq9" ? (
          <Phq9Form
            onSaved={() => {
              setOpenForm(null);
              reload();
            }}
          />
        ) : (
          <>
            <p style={{ color: "#555", marginTop: 0 }}>Девять вопросов о том, как вы себя чувствовали последние две недели.</p>
            {weeklyWait ? (
              <p style={{ color: "#555", marginTop: 0 }}>
                Опросник проходят раз в неделю. Следующий раз —{" "}
                <strong>
                  {new Date(nextAllowedAt!).toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}
                </strong>
                .
              </p>
            ) : (
              <button
                type="button"
                onClick={() => setOpenForm("phq9")}
                style={{ padding: "10px 16px", borderRadius: 8, border: "none", background: "#1f6feb", color: "white", cursor: "pointer" }}
              >
                Пройти опросник
              </button>
            )}
          </>
        )}

        {assessments && assessments.length > 0 && (
          <ul style={{ listStyle: "none", padding: 0, margin: "20px 0 0", display: "grid", gap: 8 }}>
            {assessments.map((assessment) => (
              <li key={assessment.id} style={{ borderTop: "1px solid #eaeef2", paddingTop: 10 }}>
                <details>
                  <summary style={{ cursor: "pointer" }}>
                    {formatDate(assessment.submittedAt)} — {assessment.instrumentTitle}
                  </summary>
                  <ul style={{ margin: "8px 0 0", paddingLeft: 20, color: "#333", fontSize: 14 }}>
                    {assessment.answers.map((answer) => (
                      <li key={answer.itemId}>
                        {answer.text} — <em>{answer.label}</em>
                      </li>
                    ))}
                  </ul>
                </details>
              </li>
            ))}
          </ul>
        )}
        {assessments?.length === 0 && <p style={{ color: "#777", marginBottom: 0 }}>Вы ещё не проходили опросник.</p>}
      </section>
    </main>
  );
}
