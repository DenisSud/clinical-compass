import { describe, expect, it } from "vitest";
import {
  assertStatusInstrumentsExist,
  instrument,
  patientInstrument,
  patientInstruments,
  repeatAfterHours,
} from "./loader.js";
import { PATIENT_STATUS_IDS, UnknownStatus } from "./statuses.js";

describe("набор пациента", () => {
  it("берётся из статуса, а не из списка в коде", () => {
    expect(patientInstruments("screening").map((item) => item.id)).toEqual(["phq-9"]);
    expect(patientInstruments("treatment").map((item) => item.id)).toEqual([
      "hads-anxiety",
      "hads-depression",
      "uku",
    ]);
  });

  it("держит опросник вне статуса, который его не назначает", () => {
    expect(patientInstrument("screening", "hads-anxiety")).toBeUndefined();
    expect(patientInstrument("screening", "uku")).toBeUndefined();
    expect(patientInstrument("treatment", "hads-anxiety")?.id).toBe("hads-anxiety");
  });

  it("никогда не даёт пациенту шкалу врача", () => {
    expect(instrument("hdrs-17")?.audience).toBe("doctor");
    for (const status of PATIENT_STATUS_IDS) {
      expect(patientInstruments(status).map((item) => item.id)).not.toContain("hdrs-17");
      expect(patientInstrument(status, "hdrs-17")).toBeUndefined();
    }
  });

  it("отказывает в неизвестном статусе, а не возвращает пустой набор", () => {
    expect(() => patientInstruments("remission")).toThrow(UnknownStatus);
  });

  it("называет отсутствующий файл инструмента на сборке, а не на экране пациента", () => {
    expect(() => assertStatusInstrumentsExist()).not.toThrow();
  });

  it("предпочитает интервал статуса собственному интервалу инструмента", () => {
    expect(instrument("phq-9")?.repeatAfterHours).toBe(168);
    // PHQ-9 — скрининг на входе: в терапии его нет, динамику ведут другие шкалы.
    expect(patientInstrument("treatment", "phq-9")).toBeUndefined();
    expect(repeatAfterHours("treatment", "uku")).toBe(168);
    expect(repeatAfterHours("treatment", "hads-depression")).toBe(168);
  });

  it("возвращает null для инструмента, который статус не назначает", () => {
    expect(repeatAfterHours("screening", "uku")).toBeNull();
    expect(repeatAfterHours("treatment", "phq-9")).toBeNull();
  });

  it("описывает происхождение каждого назначенного инструмента текстом, который пациент может прочитать", () => {
    for (const status of PATIENT_STATUS_IDS) {
      for (const assigned of patientInstruments(status)) {
        expect(assigned.source.note.length).toBeGreaterThan(20);
      }
    }
  });
});
