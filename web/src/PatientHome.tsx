import { useCallback, useEffect, useState } from "react";
import type {
  DiaryEntry,
  Message,
  PatientAssessment,
  PatientFactsView,
  PatientInstrumentView,
  PatientProfile,
  PlanItem,
} from "../../shared/contracts";
import {
  ApiRequestError,
  bindToDoctor,
  fetchMyAssessments,
  fetchMyDiary,
  fetchMyFacts,
  fetchMyInstruments,
  fetchMyMessages,
  fetchMyPlan,
  sendMessage,
} from "./api";
import { DiaryForm } from "./DiaryForm";
import { FactsForm } from "./FactsForm";
import { TodayPlan } from "./TodayPlan";
import { MessageThread } from "./MessageThread";
import { InstrumentForm } from "./InstrumentForm";
import { Button, Card, Empty, LoadError, Tabs, loading, track, type Load } from "./ui";

type PatientTab = "today" | "diary" | "questionnaire" | "facts" | "plan" | "doctor";

type MyAssessments = { assessments: PatientAssessment[]; nextAllowedAt: string | null };

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
}

/* «— с 21 октября» under «Ведущий врач»: the export gives the binding date without a year. */
function formatDayMonth(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

/*
 * The plan's kinds in the doctor's own words (`PlanPanel.tsx`, `KIND`). Written out here
 * rather than imported so the patient screen does not reach into a doctor screen module;
 * a fifth kind has to change both maps in the same commit.
 */
const PLAN_KIND_LABEL: Record<PlanItem["kind"], string> = {
  medication: "Препарат",
  therapy: "Терапия",
  observation: "Наблюдение",
  referral: "Направление",
};

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
  const [instruments, setInstruments] = useState<Load<PatientInstrumentView[]>>(loading());
  /** Какой опросник открыт прямо сейчас; null — список. */
  const [openInstrumentId, setOpenInstrumentId] = useState<string | null>(null);
  const [answersSaved, setAnswersSaved] = useState(false);

  const reloadAssessments = useCallback(() => {
    track(setAssessments, fetchMyAssessments());
  }, []);

  const reloadInstruments = useCallback(() => {
    track(setInstruments, fetchMyInstruments().then((response) => response.instruments));
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
    reloadInstruments();
    reloadDiary();
    reloadPlan();
    reloadMessages();
    reloadFacts();
  }, [reloadAssessments, reloadInstruments, reloadDiary, reloadPlan, reloadMessages, reloadFacts]);

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
        <Card>
          <h2 className="card__title">Введите код от врача</h2>
          {bindDone ? (
            <p className="notice">Код принят — вы привязаны к врачу.</p>
          ) : (
            <>
              <p className="muted">
                Врач передаст вам код. Пока вы его не ввели, врач не видит вашу карточку.
              </p>
              <form onSubmit={bind} className="row bind-card__form">
                <input
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  placeholder="Код привязки"
                  required
                  aria-label="Код привязки"
                  className="bind-card__code"
                />
                <Button type="submit" variant="primary" disabled={bindBusy}>
                  {bindBusy ? "Привязываемся…" : "Привязаться"}
                </Button>
              </form>
              {bindError && (
                <p className="notice notice--error bind-card__error">{bindError}</p>
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

          <Card title="Насколько вы сегодня себя чувствуете?">
            {entries.status === "loading" && <p className="notice">Проверяем запись за сегодня…</p>}
            {entries.status === "failed" && (
              <LoadError onRetry={reloadDiary}>
                Не удалось загрузить записи. Это не значит, что вы их не делали — повторите попытку.
              </LoadError>
            )}
            {entries.status === "ready" &&
              (todayEntry ? (
                <>
                  <p className="muted">
                    Сегодня отмечено: <strong>{todayEntry.value}</strong> / 10
                    {todayEntry.comment && <span> — {todayEntry.comment}</span>}
                  </p>
                  <p className="hint">Следующая запись — завтра.</p>
                </>
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
            <ul className="diary-entries">
              {entries.data.map((entry) => (
                <li key={entry.id} className="diary-entry">
                  <div className="diary-entry__head">
                    <span className="diary-entry__date">{formatDate(entry.entryDate)}</span>
                    <span className="diary-entry__value">{entry.value} / 10</span>
                  </div>
                  {entry.comment && <p className="diary-entry__comment">{entry.comment}</p>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {tab === "questionnaire" && (
        <Card title="Опросники">
          <p className="muted">
            Врач выбрал, что вам сейчас нужно пройти. Ответы видит только ваш врач.
          </p>

          {instruments.status === "loading" && <p className="notice">Загрузка опросников…</p>}
          {instruments.status === "failed" && (
            <LoadError onRetry={reloadInstruments}>
              Не удалось загрузить опросники. Это не значит, что вам ничего не назначено.
            </LoadError>
          )}

          {answersSaved && (
            <p className="notice">
              Ответы отправлены ведущему врачу. Посмотреть, что отправлено, можно в разделе
              «Прошлые ответы» ниже.
            </p>
          )}

          {instruments.status === "ready" && instruments.data.length === 0 && (
            <Empty>Врач ещё не назначил вам опросники.</Empty>
          )}

          {instruments.status === "ready" && instruments.data.length > 0 && (
            <ul className="instrument-list">
              {instruments.data.map((instrument) => (
                <li key={instrument.id} className="instrument-list__row">
                  <span className="instrument-list__title">{instrument.title}</span>
                  {instrument.nextAttemptAt === null ? (
                    <Button
                      variant="primary"
                      onClick={() => {
                        setAnswersSaved(false);
                        setOpenInstrumentId(instrument.id);
                      }}
                    >
                      Пройти
                    </Button>
                  ) : (
                    <span className="instrument-list__wait">
                      Следующий раз —{" "}
                      {new Date(instrument.nextAttemptAt).toLocaleDateString("ru-RU", {
                        day: "numeric",
                        month: "long",
                      })}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}

          {openInstrumentId !== null && (
            <InstrumentForm
              key={openInstrumentId}
              instrumentId={openInstrumentId}
              onSaved={() => {
                setOpenInstrumentId(null);
                setAnswersSaved(true);
                reloadAssessments();
                reloadInstruments();
              }}
            />
          )}

          <h3 className="section-title section-title--spaced">Прошлые ответы</h3>
          {assessments.status === "ready" && assessments.data.assessments.length === 0 && (
            <Empty>Вы ещё не проходили опросник.</Empty>
          )}
          {assessments.status === "ready" && assessments.data.assessments.length > 0 && (
            <ul className="past-answers">
              {assessments.data.assessments.map((assessment) => (
                <li key={assessment.id} className="past-answer">
                  <details>
                    <summary className="details-summary">
                      {formatDate(assessment.submittedAt)} — {assessment.instrumentTitle}
                    </summary>
                    <ul className="past-answer__list">
                      {assessment.answers.map((answer) => (
                        <li key={answer.itemId} className="past-answer__row">
                          {answer.text} — <span className="past-answer__choice">{answer.label}</span>
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
          {/*
           * Only confirmed items: `/api/plan` returns `active` ones
           * (`server/routes/plan.ts:115`), so a draft never reaches this screen and no
           * state word or filter is drawn here. The kind is the doctor's word, the
           * explanation is optional and stays under the title (patient.css, `.plan-entry`).
           */}
          {plan.status === "ready" && plan.data.length > 0 && (
            <>
              <ul className="plan-entries">
                {plan.data.map((item) => (
                  <li key={item.id} className="plan-entry">
                    <p className="plan-entry__kind">{PLAN_KIND_LABEL[item.kind]}</p>
                    <p className="plan-entry__title">{item.title}</p>
                    {item.details && <p className="plan-entry__details">{item.details}</p>}
                  </li>
                ))}
              </ul>
              {/*
               * No actions here and one quiet line saying why: an item becomes visible
               * only after the doctor confirms it (GLOSSARY.md, «План»).
               */}
              <p className="hint">План ведёт врач.</p>
            </>
          )}
        </Card>
      )}

      {tab === "doctor" && (
        <Card title="Ведущий врач">
          {profile.doctor ? (
            <p className="muted">
              {profile.doctor.name ?? profile.doctor.email}
              {profile.boundAt && ` — с ${formatDayMonth(profile.boundAt)}`}
            </p>
          ) : (
            <p className="muted">
              Вы пока не привязаны к врачу. Введите код приглашения — форма выше на этом экране.
            </p>
          )}

          <h3 className="section-title section-title--spaced">Переписка</h3>
          {messages.status === "loading" && <p className="notice">Загрузка переписки…</p>}
          {messages.status === "failed" && (
            <LoadError onRetry={reloadMessages}>
              Не удалось загрузить переписку. Это не значит, что сообщений не было — повторите попытку.
            </LoadError>
          )}
          {messages.status === "ready" && (
            <MessageThread
              messages={messages.data}
              viewer="patient"
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
