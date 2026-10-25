import { useCallback, useEffect, useState } from "react";
import type {
  DiaryEntry,
  Message,
  PatientAssessment,
  PatientFactsView,
  PatientProfile,
  PlanItem,
} from "../../shared/contracts";
import {
  ApiRequestError,
  bindToDoctor,
  fetchMyAssessments,
  fetchMyDiary,
  fetchMyFacts,
  fetchMyMessages,
  fetchMyPlan,
  sendMessage,
} from "./api";
import { DiaryForm } from "./DiaryForm";
import { FactsForm } from "./FactsForm";
import { TodayPlan } from "./TodayPlan";
import { MessageThread } from "./MessageThread";
import { Phq9Form } from "./Phq9Form";
import { Button, Card, Empty, LoadError, Tabs, loading, track, type Load } from "./ui";

type PatientTab = "today" | "diary" | "questionnaire" | "facts" | "plan" | "doctor";

type MyAssessments = { assessments: PatientAssessment[]; nextAllowedAt: string | null };

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
}

export function PatientHome({
  profile,
  onChanged,
}: {
  profile: PatientProfile;
  onChanged: () => void;
}) {
  const [tab, setTab] = useState<PatientTab>("today");
  const [code, setCode] = useState("");
  const [bindError, setBindError] = useState<string | null>(null);
  const [bindBusy, setBindBusy] = useState(false);
  const [bindDone, setBindDone] = useState(false);
  const [assessments, setAssessments] = useState<Load<MyAssessments>>(loading());
  const [entries, setEntries] = useState<Load<DiaryEntry[]>>(loading());
  const [plan, setPlan] = useState<Load<PlanItem[]>>(loading());
  const [messages, setMessages] = useState<Load<Message[]>>(loading());
  const [facts, setFacts] = useState<Load<PatientFactsView>>(loading());
  const [openForm, setOpenForm] = useState<"phq9" | null>(null);
  const [answersSaved, setAnswersSaved] = useState(false);

  const reloadAssessments = useCallback(() => {
    track(setAssessments, fetchMyAssessments());
  }, []);

  const reloadDiary = useCallback(() => {
    track(setEntries, fetchMyDiary().then((response) => response.entries));
  }, []);

  const reloadPlan = useCallback(() => {
    track(setPlan, fetchMyPlan().then((response) => response.items));
  }, []);

  const reloadMessages = useCallback(() => {
    track(setMessages, fetchMyMessages().then((response) => response.messages));
  }, []);

  const reloadFacts = useCallback(() => {
    track(setFacts, fetchMyFacts());
  }, []);

  useEffect(() => {
    reloadAssessments();
    reloadDiary();
    reloadPlan();
    reloadMessages();
    reloadFacts();
  }, [reloadAssessments, reloadDiary, reloadPlan, reloadMessages, reloadFacts]);

  async function bind(event: React.FormEvent) {
    event.preventDefault();
    setBindBusy(true);
    setBindError(null);
    try {
      await bindToDoctor(code);
      setCode("");
      setBindDone(true);
      onChanged();
    } catch (cause) {
      setBindError(cause instanceof ApiRequestError ? cause.message : "Не удалось привязаться");
    } finally {
      setBindBusy(false);
    }
  }

  const today = new Date().toLocaleDateString("sv-SE");
  const todayEntry = entries.status === "ready" ? entries.data.find((entry) => entry.entryDate === today) : undefined;
  const weeklyWait =
    assessments.status === "ready" &&
    assessments.data.nextAllowedAt !== null &&
    new Date(assessments.data.nextAllowedAt).getTime() > Date.now();

  /*
   * Вход в «Мои данные» с «Сегодня» (#48): без счётчика, без значка на вкладке и без
   * оценки — неполнота это не риск (DESIGN.md §2.2). Сбой загрузки не выдаётся за
   * «спросили обо всём»: строка тогда просто не утверждает, что вопросы остались (§2.5).
   */
  const factsInvite =
    facts.status === "failed"
      ? "Не удалось проверить, всё ли мы у вас спросили — вопросы о себе лежат в разделе «Мои данные»."
      : facts.status === "ready" && facts.data.unanswered.length > 0
        ? "О чём мы ещё не спрашивали — в разделе «Мои данные»."
        : null;

  return (
    <main className="page page--patient">
      {bindDone && profile.doctor && (
        <Card>
          <p className="notice">Код принят — вы привязаны к врачу.</p>
        </Card>
      )}

      {!profile.doctor && (
        <Card className="bind-card">
          <h2 className="card__title" style={{ marginTop: 0 }}>
            Введите код от врача
          </h2>
          {bindDone ? (
            <p className="notice">Код принят — вы привязаны к врачу.</p>
          ) : (
            <>
              <p className="muted">
                Врач передаст вам код. Пока вы его не ввели, врач не видит вашу карточку.
              </p>
              <form onSubmit={bind} className="row" style={{ marginTop: 12 }}>
                <input
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  placeholder="Код привязки"
                  required
                  aria-label="Код привязки"
                  style={{
                    padding: "10px 12px",
                    borderRadius: "var(--radius-surface)",
                    border: "1px solid var(--border-divider)",
                    fontFamily: "var(--font-mono)",
                    letterSpacing: 2,
                    textTransform: "uppercase",
                    width: 180,
                    maxWidth: "100%",
                    minHeight: 44,
                  }}
                />
                <Button type="submit" variant="primary" disabled={bindBusy}>
                  {bindBusy ? "Привязываемся…" : "Привязаться"}
                </Button>
              </form>
              {bindError && (
                <p className="notice notice--error" style={{ marginTop: 8 }}>
                  {bindError}
                </p>
              )}
            </>
          )}
        </Card>
      )}

      <Tabs<PatientTab>
        label="Разделы карточки"
        value={tab}
        onChange={setTab}
        items={[
          { id: "today", label: "Сегодня" },
          { id: "diary", label: "Дневник" },
          { id: "questionnaire", label: "Опросник" },
          { id: "facts", label: "Мои данные" },
          { id: "plan", label: "План" },
          { id: "doctor", label: "Врач" },
        ]}
      />

      {tab === "today" && (
        <div className="stack">
          <Card title="Назначения на сегодня">
            <TodayPlan />
          </Card>

          <Card title="Самочувствие">
            {entries.status === "loading" && <p className="notice">Проверяем запись за сегодня…</p>}
            {entries.status === "failed" && (
              <LoadError onRetry={reloadDiary}>
                Не удалось загрузить записи. Это не значит, что вы их не делали — повторите попытку.
              </LoadError>
            )}
            {entries.status === "ready" &&
              (todayEntry ? (
                <p className="muted">
                  Сегодня отмечено: <strong>{todayEntry.value}</strong> / 10
                  {todayEntry.comment && <span> — {todayEntry.comment}</span>}
                  <br />
                  <span className="hint" style={{ display: "inline-block" }}>
                    Следующая запись — завтра.
                  </span>
                </p>
              ) : (
                <DiaryForm onSaved={reloadDiary} />
              ))}
          </Card>

          {factsInvite && (
            <div className="facts-invite">
              <p className="notice">{factsInvite}</p>
              <Button variant="quiet" onClick={() => setTab("facts")}>
                Открыть «Мои данные»
              </Button>
            </div>
          )}
        </div>
      )}

      {tab === "diary" && (
        <Card title="Дневник самочувствия">
          {entries.status === "loading" && <p className="notice">Загрузка записей…</p>}
          {entries.status === "failed" && (
            <LoadError onRetry={reloadDiary}>
              Не удалось загрузить записи. Это не значит, что записей не было — повторите попытку.
            </LoadError>
          )}
          {entries.status === "ready" && entries.data.length === 0 && (
            <Empty>Записей пока нет. Первая запись появится на вкладке «Сегодня».</Empty>
          )}
          {entries.status === "ready" && entries.data.length > 0 && (
            <ul className="stack" style={{ gap: 10, margin: 0, padding: 0, listStyle: "none" }}>
              {entries.data.map((entry) => (
                <li key={entry.id} style={{ borderTop: "1px solid var(--border-hairline)", paddingTop: 10 }}>
                  <strong>{entry.value}</strong>
                  <span className="hint" style={{ marginLeft: 4 }}>
                    / 10 — {formatDate(entry.entryDate)}
                  </span>
                  {entry.comment && <p style={{ margin: "4px 0 0", color: "var(--text-body)" }}>{entry.comment}</p>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {tab === "questionnaire" && (
        <Card title="Опросник PHQ-9">
          <p className="muted">Девять вопросов о том, как вы себя чувствовали последние две недели.</p>

          {assessments.status === "loading" && (
            <p className="notice">Проверяем, можно ли пройти опросник…</p>
          )}
          {assessments.status === "failed" && (
            <LoadError onRetry={reloadAssessments}>
              Не удалось загрузить опросник. Это не значит, что вы его не проходили — повторите попытку.
            </LoadError>
          )}

          {answersSaved && (
            <p className="notice">
              Ответы отправлены ведущему врачу. Посмотреть, что отправлено, можно в разделе
              «Прошлые ответы» ниже.
            </p>
          )}

          {openForm === "phq9" ? (
            <Phq9Form
              onSaved={() => {
                setOpenForm(null);
                setAnswersSaved(true);
                reloadAssessments();
              }}
            />
          ) : (
            assessments.status === "ready" &&
            (weeklyWait ? (
              <p className="muted">
                Опросник проходят раз в неделю. Следующий раз —{" "}
                <strong>
                  {new Date(assessments.data.nextAllowedAt!).toLocaleDateString("ru-RU", {
                    day: "numeric",
                    month: "long",
                  })}
                </strong>
                .
              </p>
            ) : (
              <Button
                variant="primary"
                onClick={() => {
                  setAnswersSaved(false);
                  setOpenForm("phq9");
                }}
              >
                Пройти опросник
              </Button>
            ))
          )}

          <h3 className="section-title" style={{ marginTop: 24 }}>
            Прошлые ответы
          </h3>
          {assessments.status === "ready" && assessments.data.assessments.length === 0 && (
            <Empty>Вы ещё не проходили опросник.</Empty>
          )}
          {assessments.status === "ready" && assessments.data.assessments.length > 0 && (
            <ul className="stack" style={{ gap: 8, margin: 0, padding: 0, listStyle: "none" }}>
              {assessments.data.assessments.map((assessment) => (
                <li key={assessment.id} style={{ borderTop: "1px solid var(--border-hairline)", paddingTop: 10 }}>
                  <details>
                    <summary className="details-summary">
                      {formatDate(assessment.submittedAt)} — {assessment.instrumentTitle}
                    </summary>
                    <ul style={{ margin: "8px 0 0", paddingLeft: 20, color: "var(--text-body)", fontSize: 14 }}>
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
        </Card>
      )}

      {tab === "facts" && <FactsForm />}

      {tab === "plan" && (
        <Card title="План лечения">
          {plan.status === "loading" && <p className="notice">Загрузка плана…</p>}
          {plan.status === "failed" && (
            <LoadError onRetry={reloadPlan}>
              Не удалось загрузить план. Это не значит, что врач его не назначил — повторите попытку.
            </LoadError>
          )}
          {plan.status === "ready" && plan.data.length === 0 && (
            <Empty>
              Врач пока не добавил план. Пункты появляются здесь после того, как врач их подтвердит.
            </Empty>
          )}
          {plan.status === "ready" && plan.data.length > 0 && (
            <ul className="stack" style={{ gap: 10, margin: 0, padding: 0, listStyle: "none" }}>
              {plan.data.map((item) => (
                <li key={item.id} style={{ borderLeft: "3px solid var(--signal-done)", paddingLeft: 12 }}>
                  <strong>{item.title}</strong>
                  {item.details && <p style={{ margin: "2px 0 0", color: "var(--text-body)" }}>{item.details}</p>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {tab === "doctor" && (
        <Card title="Ведущий врач">
          {profile.doctor ? (
            <p className="muted">
              {profile.doctor.name ?? profile.doctor.email}
              {profile.boundAt && (
                <span className="hint" style={{ display: "inline-block", marginLeft: 4 }}>
                  — с{" "}
                  {new Date(profile.boundAt).toLocaleDateString("ru-RU", {
                    day: "numeric",
                    month: "long",
                  })}
                </span>
              )}
            </p>
          ) : (
            <p className="muted">
              Вы пока не привязаны к врачу. Введите код приглашения — форма выше на этом экране.
            </p>
          )}

          <h3 className="section-title" style={{ marginTop: 20 }}>
            Переписка
          </h3>
          {messages.status === "loading" && <p className="notice">Загрузка переписки…</p>}
          {messages.status === "failed" && (
            <LoadError onRetry={reloadMessages}>
              Не удалось загрузить переписку. Это не значит, что сообщений не было — повторите попытку.
            </LoadError>
          )}
          {messages.status === "ready" && (
            <MessageThread
              messages={messages.data}
              placeholder="Напишите сообщение врачу"
              onSend={async (body) => {
                const response = await sendMessage(body);
                setMessages((current) =>
                  current.status === "ready"
                    ? { status: "ready", data: [...current.data, response.message] }
                    : current,
                );
              }}
            />
          )}
          {!profile.doctor && (
            <p className="hint">
              Пока вы не привязаны к врачу, сообщения сохраняются в вашей карточке. Врач прочитает их,
              когда вы привяжетесь.
            </p>
          )}
        </Card>
      )}
    </main>
  );
}
