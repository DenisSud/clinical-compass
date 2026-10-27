import { useCallback, useEffect, useState } from "react";
import { nextAppointment, reminderDue } from "../../shared/appointments";
import type { Appointment } from "../../shared/contracts";
import {
  ApiRequestError,
  cancelAppointment,
  createAppointment,
  fetchPatientAppointments,
} from "./api";
import { Button, Card, LoadError, loading, track, type Load } from "./ui";

/** Дата и время приёма — без «осталось два дня»: срок — это интерпретация (DESIGN.md §2.2). */
function formatAppointment(iso: string): string {
  return new Date(iso).toLocaleString("ru-RU", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function useAppointments(patientId: string) {
  const [appointments, setAppointments] = useState<Load<Appointment[]>>(loading());

  const reload = useCallback(() => {
    track(setAppointments, fetchPatientAppointments(patientId).then((response) => response.appointments));
  }, [patientId]);

  useEffect(reload, [reload]);

  return { appointments, reload };
}

/**
 * Блок «Следующий приём» в карточке врача. Дату ставит психиатр (SPEC S24, Q49),
 * терапевт её только читает: назначение приёма — часть лечения, а не наблюдения.
 */
export function DoctorAppointment({
  patientId,
  canEdit,
}: {
  patientId: string;
  canEdit: boolean;
}) {
  const { appointments, reload } = useAppointments(patientId);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cancelStep, setCancelStep] = useState(false);

  const next = appointments.status === "ready" ? nextAppointment(appointments.data, new Date()) : null;

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // Ввод местный, хранение — ISO с зоной: иначе «следующий приём» зависел бы от часов того, кто смотрит карточку.
      await createAppointment(patientId, new Date(value).toISOString());
      setValue("");
      reload();
    } catch (cause) {
      setError(cause instanceof ApiRequestError ? cause.message : "Не удалось назначить приём");
    } finally {
      setBusy(false);
    }
  }

  async function cancel(appointmentId: string) {
    setBusy(true);
    setError(null);
    try {
      await cancelAppointment(patientId, appointmentId);
      setCancelStep(false);
      reload();
    } catch (cause) {
      setError(cause instanceof ApiRequestError ? cause.message : "Не удалось отменить приём");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h3 className="section-title">Следующий приём</h3>

      {appointments.status === "loading" && <p className="notice">Загрузка приёма…</p>}
      {appointments.status === "failed" && (
        <LoadError onRetry={reload}>
          Не удалось загрузить приём. Это не значит, что он не назначен.
        </LoadError>
      )}

      {appointments.status === "ready" && (
        <>
          {next ? (
            <>
              <p className="muted">{formatAppointment(next.scheduledAt)}</p>
              {canEdit &&
                (cancelStep ? (
                  <div className="confirm">
                    <p className="confirm__question">
                      Отменить приём? Пациент больше не увидит эту дату.
                    </p>
                    <div className="row">
                      <Button onClick={() => void cancel(next.id)} disabled={busy}>
                        {busy ? "Отменяем…" : "Да, отменить"}
                      </Button>
                      <Button onClick={() => setCancelStep(false)} disabled={busy}>
                        Отмена
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button className="button--quiet" onClick={() => setCancelStep(true)}>
                    Отменить приём
                  </Button>
                ))}
            </>
          ) : (
            <p className="muted">Приём не назначен.</p>
          )}

          {canEdit && (
            <form onSubmit={save} className="row" style={{ marginTop: 12 }}>
              <input
                type="datetime-local"
                value={value}
                onChange={(event) => setValue(event.target.value)}
                required
                aria-label="Дата и время приёма"
              />
              <Button type="submit" variant="primary" disabled={busy || value === ""}>
                {busy ? "Сохраняем…" : next ? "Перенести приём" : "Назначить приём"}
              </Button>
            </form>
          )}
          {canEdit && (
            <p className="hint">
              Новый приём заменяет прошлый будущий: прежняя дата отменяется, но остаётся в
              истории.
            </p>
          )}
          {error && (
            <p className="notice notice--error" role="alert">
              {error}
            </p>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Приём на экране пациента: дата и время, без оценки и без «сколько осталось».
 * Внутри суток к строке добавляется напоминание (SPEC S24, Q49).
 */
export function PatientAppointment({ patientId }: { patientId: string }) {
  const { appointments, reload } = useAppointments(patientId);
  const now = new Date();
  const next = appointments.status === "ready" ? nextAppointment(appointments.data, now) : null;

  return (
    <Card title="Приём">
      {appointments.status === "loading" && <p className="notice">Загрузка приёма…</p>}
      {appointments.status === "failed" && (
        <LoadError onRetry={reload}>
          Не удалось загрузить приём. Это не значит, что приёма нет — повторите попытку.
        </LoadError>
      )}
      {appointments.status === "ready" && !next && <p className="muted">Приём пока не назначен.</p>}
      {appointments.status === "ready" && next && (
        <>
          <p className="muted">Врач назначил приём: {formatAppointment(next.scheduledAt)}.</p>
          {reminderDue(next, now) && (
            <p className="notice">Напоминание: приём {formatAppointment(next.scheduledAt)}.</p>
          )}
        </>
      )}
    </Card>
  );
}
