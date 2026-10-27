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
 * A draft is invisible to the patient, a confirmed item is the plan itself and an
 * archived one is history. The word carries that difference, so it is spelled out on
 * every row (#53) — a state that only shows as a missing button is a state a doctor
 * has to reconstruct.
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
   * There is no way back from the archive (§ the route has confirm and archive, nothing
   * else), so the press asks first — the same .confirm the unbind and the code rotation
   * use. The question closes only when the server answered: a failed archive keeps it
   * open with the reason next to it, so the doctor can retry where he stands.
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
               * Kind, title and state on one line, the explanation under them (_10,
               * system §2.16). The kind stays a word: colour on this screen belongs to
               * severity, and a coloured capsule for «Направление» would compete with the
               * critical signal card one tab away (§2.3, §3.1).
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
       * One field per line with its own label, the way the export draws the form (_10):
       * the two fields name different things — what is prescribed and how it is taken —
       * and a placeholder cannot say that after the first character is typed. The
       * export's placeholder examples («Сертралин 50 мг») are made-up prescriptions and
       * are not carried over (migration §2.4).
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
