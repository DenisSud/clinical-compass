import { useCallback, useEffect, useState } from "react";
import type {
  BindingCodeResponse,
  DoctorSignal,
  PatientSummary,
} from "../../shared/contracts";
import { ApiRequestError, fetchBindingCode, fetchPatients, fetchSignals, rotateBindingCode } from "./api";
import { PatientDetail } from "./PatientDetail";
import { SignalsPanel } from "./SignalsPanel";
import { Button, Empty, LoadError, Tabs, loading, track, type Load } from "./ui";

type DoctorView = "signals" | "patients";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

export function DoctorHome() {
  const [view, setView] = useState<DoctorView>("signals");
  const [signals, setSignals] = useState<Load<DoctorSignal[]>>(loading());
  const [patients, setPatients] = useState<Load<PatientSummary[]>>(loading());
  const [bindingCode, setBindingCode] = useState<Load<BindingCodeResponse>>(loading());
  const [selected, setSelected] = useState<PatientSummary | null>(null);
  const [rotateConfirm, setRotateConfirm] = useState(false);
  const [rotateBusy, setRotateBusy] = useState(false);
  const [rotateError, setRotateError] = useState<string | null>(null);
  const [rotateDone, setRotateDone] = useState(false);

  const loadSignals = useCallback(() => {
    track(setSignals, fetchSignals().then((response) => response.signals));
  }, []);

  const loadPatients = useCallback(() => {
    track(setPatients, fetchPatients().then((response) => response.patients));
  }, []);

  const loadBindingCode = useCallback(() => {
    track(setBindingCode, fetchBindingCode());
  }, []);

  useEffect(() => {
    loadSignals();
    loadPatients();
    loadBindingCode();
  }, [loadSignals, loadPatients, loadBindingCode]);

  const handleSignalUpdated = useCallback((updated: DoctorSignal) => {
    setSignals((current) =>
      current.status === "ready"
        ? { status: "ready", data: current.data.map((signal) => (signal.id === updated.id ? updated : signal)) }
        : current,
    );
  }, []);

  async function rotate() {
    setRotateBusy(true);
    setRotateError(null);
    setRotateDone(false);
    try {
      const response = await rotateBindingCode();
      setBindingCode({ status: "ready", data: response });
      setRotateConfirm(false);
      setRotateDone(true);
    } catch (cause) {
      setRotateError(
        cause instanceof ApiRequestError
          ? cause.message
          : "Не удалось перевыпустить код — попробуйте ещё раз.",
      );
    } finally {
      setRotateBusy(false);
    }
  }

  const openSignals =
    signals.status === "ready"
      ? signals.data.filter((signal) => signal.status !== "closed").length
      : null;
  const patientCount = patients.status === "ready" ? patients.data.length : null;

  return (
    <main className="page page--wide">
      <Tabs<DoctorView>
        label="Разделы кабинета"
        value={view}
        onChange={setView}
        items={[
          { id: "signals", label: "Сигналы", count: openSignals },
          { id: "patients", label: "Пациенты", count: patientCount },
        ]}
      />

      {view === "signals" && (
        <SignalsPanel
          signals={signals}
          onRetry={loadSignals}
          onUpdated={handleSignalUpdated}
        />
      )}

      {view === "patients" && (
        <div className={selected ? "patients is-open" : "patients"}>
          <div className="patients__list">
            <details className="disclosure">
              <summary>Пригласить пациента</summary>
              <div className="disclosure__body">
                <p className="muted">
                  Пациент вводит этот код в своей карточке, чтобы привязаться к вам. Пока он этого не
                  сделал, вы его не видите.
                </p>

                {bindingCode.status === "loading" && <p className="notice">Загрузка кода…</p>}

                {bindingCode.status === "failed" && (
                  <LoadError onRetry={loadBindingCode}>
                    Не удалось загрузить код приглашения. Это не значит, что кода нет.
                  </LoadError>
                )}

                {bindingCode.status === "ready" && (
                  <>
                    <p className="code">{bindingCode.data.code}</p>
                    <p className="hint">Действует до {formatDate(bindingCode.data.expiresAt)}</p>

                    {rotateDone && (
                      <p className="notice">Код перевыпущен — старый больше не действует.</p>
                    )}
                    {rotateError && <p className="notice notice--error">{rotateError}</p>}

                    {rotateConfirm ? (
                      <div className="confirm">
                        <p className="confirm__question">
                          Перевыпустить код? Старый код перестанет действовать, и пациент не сможет
                          привязаться по нему.
                        </p>
                        <div className="row">
                          <Button variant="primary" onClick={() => void rotate()} disabled={rotateBusy}>
                            {rotateBusy ? "Перевыпускаем…" : "Да, перевыпустить"}
                          </Button>
                          <Button onClick={() => setRotateConfirm(false)} disabled={rotateBusy}>
                            Отмена
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <Button
                        onClick={() => {
                          setRotateError(null);
                          setRotateConfirm(true);
                        }}
                      >
                        Перевыпустить код
                      </Button>
                    )}
                  </>
                )}
              </div>
            </details>

            <h2 className="section-title">Мои пациенты</h2>

            {patients.status === "loading" && <p className="notice">Загрузка пациентов…</p>}

            {patients.status === "failed" && (
              <LoadError onRetry={loadPatients}>
                Не удалось загрузить список пациентов. Это не значит, что их нет — повторите попытку.
              </LoadError>
            )}

            {patients.status === "ready" && patients.data.length === 0 && (
              <Empty>Пока никого. Пригласите пациента кодом выше.</Empty>
            )}

            {patients.status === "ready" && patients.data.length > 0 && (
              <ul className="patient-list">
                {patients.data.map((patient) => (
                  <li key={patient.id}>
                    <button
                      type="button"
                      className="patient-list__item"
                      aria-current={selected?.id === patient.id}
                      onClick={() => setSelected(patient)}
                    >
                      {patient.name ?? patient.email}
                      {patient.boundAt && (
                        <span className="hint" style={{ display: "block" }}>
                          с {formatDate(patient.boundAt)}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="patients__card">
            {selected ? (
              <>
                <Button className="back" onClick={() => setSelected(null)}>
                  ← Назад
                </Button>
                <PatientDetail
                  key={selected.id}
                  patient={selected}
                  onUnbound={() => {
                    setSelected(null);
                    loadPatients();
                  }}
                />
              </>
            ) : (
              <p className="muted patients__placeholder">Выберите пациента в списке.</p>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
