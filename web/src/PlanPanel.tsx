import { useCallback, useEffect, useState } from "react";
import type { PlanItem } from "../../shared/contracts";
import {
  ApiRequestError,
  archivePlanItem,
  confirmPlanItem,
  createPlanItem,
  fetchPatientPlan,
} from "./api";
import { Button, Empty, LoadError, loading, track, type Load } from "./ui";

const KIND: Record<PlanItem["kind"], string> = {
  medication: "Препарат",
  therapy: "Терапия",
  observation: "Наблюдение",
  referral: "Направление",
};

const KINDS: PlanItem["kind"][] = ["medication", "therapy", "observation", "referral"];

/**
 * Черновик пациент не видит, подтверждённый пункт это и есть план, а архивный уже история.
 * Слово несёт эту разницу, поэтому оно выписано на каждой строке (#53): состояние, которое
 * видно только по отсутствующей кнопке, врачу приходится восстанавливать самому.
 */
const STATUS: Record<PlanItem["status"], string> = {
  draft: "черновик",
  active: "подтверждён",
  archived: "в архиве",
};

export function PlanPanel({
  patientId,
  canEdit,
  onChanged,
}: {
  patientId: string;
  /** Терапевт план читает, но не создаёт и не меняет: это дело психиатра (SPEC S7, Q50). */
  canEdit: boolean;
  onChanged?: () => void;
}) {
  const [items, setItems] = useState<Load<PlanItem[]>>(loading());
  const [kind, setKind] = useState<PlanItem["kind"]>("medication");
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<{ itemId: string; message: string } | null>(null);
  /** The row asking «в архив?». Asked on a press, never before: see `archive` below. */
  const [archiving, setArchiving] = useState<string | null>(null);

  const reload = useCallback(() => {
    track(setItems, fetchPatientPlan(patientId).then((response) => response.items));
  }, [patientId]);

  useEffect(reload, [reload]);

  async function act(itemId: string, key: string, action: () => Promise<unknown>): Promise<boolean> {
    setBusy(key);
    setActionError(null);
    try {
      await action();
      reload();
      onChanged?.();
      return true;
    } catch (cause) {
      setActionError({
        itemId,
        message: cause instanceof ApiRequestError ? cause.message : "Не удалось выполнить действие",
      });
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function confirm(itemId: string) {
    await act(itemId, `confirm:${itemId}`, () => confirmPlanItem(itemId));
  }

  /*
   * Из архива нет пути назад (у маршрута есть подтверждение и архив, больше ничего), поэтому
   * нажатие сначала спрашивает: тот же .confirm, что у отвязки и смены кода. Вопрос
   * закрывается только когда сервер ответил: неудачный архив оставляет его открытым с причиной
   * рядом, чтобы врач мог повторить на месте.
   */
  async function archive(itemId: string) {
    const done = await act(itemId, `archive:${itemId}`, () => archivePlanItem(itemId));
    if (done) setArchiving(null);
  }

  async function add(event: React.FormEvent) {
    event.preventDefault();
    if (title.trim() === "") {
      setFormError("Введите, что назначаем.");
      return;
    }
    setBusy("create");
    setFormError(null);
    try {
      await createPlanItem(patientId, {
        kind,
        title,
        details: details.trim() === "" ? undefined : details,
      });
      setTitle("");
      setDetails("");
      reload();
      onChanged?.();
    } catch (cause) {
      setFormError(cause instanceof ApiRequestError ? cause.message : "Не удалось добавить пункт плана");
    } finally {
      setBusy(null);
    }
  }

  const blocked = busy !== null;

  return (
    <div>
      {items.status === "loading" && <p className="notice">Загрузка плана…</p>}

      {items.status === "failed" && (
        <LoadError onRetry={reload}>
          Не удалось загрузить план лечения. Это не значит, что плана нет — повторите попытку.
        </LoadError>
      )}

      {items.status === "ready" && items.data.length === 0 && (
        <Empty>
          {canEdit
            ? "Плана пока нет. Черновик ниже пациент не увидит до подтверждения."
            : "Плана пока нет. Назначает и меняет его психиатр."}
        </Empty>
      )}

      {items.status === "ready" && items.data.length > 0 && (
        <ul className="plan-list">
          {items.data.map((item) => (
            <li key={item.id} className={`plan-item plan-item--${item.status}`}>
              {/*
               * Вид, название и состояние на одной строке, пояснение под ними (_10,
               * system §2.16). Вид остаётся словом: цвет на этом экране принадлежит тяжести,
               * а цветная капсула для «Направление» соревновалась бы с карточкой критического
               * сигнала на соседней вкладке (§2.3, §3.1).
               */}
              <div className="plan-item__head">
                <span className="plan-item__kind">{KIND[item.kind]}</span>
                <strong className="plan-item__title">{item.title}</strong>
                <span className="plan-item__status">{STATUS[item.status]}</span>
              </div>
              {item.details && <p className="plan-item__details">{item.details}</p>}

              {/* An archived item is history: it keeps its text and its state, no actions. */}
              {canEdit && item.status !== "archived" && archiving !== item.id && (
                <div className="plan-item__actions">
                  {item.status === "draft" && (
                    <Button
                      variant="primary"
                      disabled={blocked}
                      onClick={() => void confirm(item.id)}
                    >
                      {busy === `confirm:${item.id}` ? "Подтверждаем…" : "Подтвердить"}
                    </Button>
                  )}
                  <Button
                    className="button--quiet"
                    disabled={blocked}
                    onClick={() => {
                      setActionError(null);
                      setArchiving(item.id);
                    }}
                  >
                    В архив
                  </Button>
                </div>
              )}

              {archiving === item.id && (
                <div className="confirm">
                  <p className="confirm__question">
                    Отправить пункт в архив? Вернуть его из архива в интерфейсе нельзя.
                  </p>
                  <div className="row">
                    <Button disabled={blocked} onClick={() => void archive(item.id)}>
                      {busy === `archive:${item.id}` ? "Отправляем…" : "Да, в архив"}
                    </Button>
                    <Button disabled={blocked} onClick={() => setArchiving(null)}>
                      Отмена
                    </Button>
                  </div>
                </div>
              )}

              {actionError?.itemId === item.id && (
                <p className="notice notice--error" role="alert">
                  {actionError.message}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {/*
       * Одно поле на строку со своей подписью, как рисует форму экспорт (_10):
       * два поля называют разное, что назначено и как это принимают,
       * и заполнитель не может сказать этого после первого набранного символа. Примеры
       * заполнителей из экспорта («Сертралин 50 мг») это выдуманные назначения, их
       * не переносим (migration §2.4).
       */}
      {!canEdit && (
        <p className="hint">
          План лечения ведёт психиатр. Вы видите его, но не меняете — это правило ролей, а не
          настройка.
        </p>
      )}

      {canEdit && (
        <form onSubmit={add} className="plan-form">
          <fieldset className="plan-form__kinds">
            <legend className="plan-form__label">Вид плана</legend>
            {KINDS.map((value) => (
              <label key={value} className="choice">
                <input
                  type="radio"
                  name="plan-kind"
                  value={value}
                  checked={kind === value}
                  onChange={() => setKind(value)}
                />
                {KIND[value]}
              </label>
            ))}
          </fieldset>

          <div className="plan-form__field">
            <label className="plan-form__label" htmlFor="plan-title">
              Что назначаем
            </label>
            <input
              id="plan-title"
              type="text"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>

          <div className="plan-form__field">
            <label className="plan-form__label" htmlFor="plan-details">
              Как принимать, как часто (необязательно)
            </label>
            <input
              id="plan-details"
              type="text"
              value={details}
              onChange={(event) => setDetails(event.target.value)}
            />
          </div>

          {formError && (
            <p className="notice notice--error" role="alert">
              {formError}
            </p>
          )}

          <Button type="submit" variant="primary" disabled={blocked}>
            {busy === "create" ? "Сохраняем…" : "Добавить в черновик"}
          </Button>
          <p className="hint">Пациент увидит пункт только после подтверждения.</p>
        </form>
      )}
    </div>
  );
}
