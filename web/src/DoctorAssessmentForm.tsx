import { useCallback, useEffect, useState } from "react";
import type { InstrumentChoice } from "../../shared/contracts";
import { InstrumentForm } from "./InstrumentForm";
import { fetchDoctorInstruments } from "./api";
import { Button, Empty, LoadError, loading, track, type Load } from "./ui";

/**
 * Шкалы, которые врач заполняет после приёма (SPEC S14, Q53). Список приходит из файлов
 * шкал, а не из имени в коде: вторая врачебная шкала появляется файлом. Терапевт её не
 * заполняет — только читает результаты в таблице ниже (SPEC S7, Q50).
 */
export function DoctorAssessmentForm({
  patientId,
  canFill,
  onSaved,
}: {
  patientId: string;
  canFill: boolean;
  onSaved: () => void;
}) {
  const [instruments, setInstruments] = useState<Load<InstrumentChoice[]>>(loading());
  const [openId, setOpenId] = useState<string | null>(null);

  const reload = useCallback(() => {
    track(setInstruments, fetchDoctorInstruments(patientId).then((response) => response.instruments));
  }, [patientId]);

  useEffect(reload, [reload]);

  if (!canFill) return null;

  return (
    <div>
      <h3 className="section-title">Оценка после приёма</h3>

      {instruments.status === "loading" && <p className="notice">Загрузка шкал…</p>}
      {instruments.status === "failed" && (
        <LoadError onRetry={reload}>
          Не удалось загрузить шкалы врача. Это не значит, что их нет.
        </LoadError>
      )}
      {instruments.status === "ready" && instruments.data.length === 0 && (
        <Empty>Шкал для врача пока нет.</Empty>
      )}

      {instruments.status === "ready" && instruments.data.length > 0 && (
        <ul className="instrument-list">
          {instruments.data.map((instrument) => (
            <li key={instrument.id} className="instrument-list__row">
              <span className="instrument-list__title">{instrument.title}</span>
              <Button
                variant="primary"
                onClick={() => setOpenId((current) => (current === instrument.id ? null : instrument.id))}
              >
                {openId === instrument.id ? "Свернуть" : "Заполнить"}
              </Button>
            </li>
          ))}
        </ul>
      )}

      {openId !== null && (
        <InstrumentForm
          key={openId}
          instrumentId={openId}
          patientId={patientId}
          onSaved={() => {
            setOpenId(null);
            onSaved();
          }}
        />
      )}
    </div>
  );
}
