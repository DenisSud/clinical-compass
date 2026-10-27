import { describe, expect, it } from "vitest";
import {
  assertStatusInstrumentsExist,
  instrument,
  patientInstrument,
  patientInstruments,
  repeatAfterHours,
} from "./loader.js";
import { PATIENT_STATUS_IDS, UnknownStatus } from "./statuses.js";

describe("the patient's set", () => {
  it("comes from the status, not from a list in code", () => {
    expect(patientInstruments("screening").map((item) => item.id)).toEqual(["phq-9"]);
    expect(patientInstruments("treatment").map((item) => item.id)).toEqual([
      "hads-anxiety",
      "hads-depression",
      "uku",
    ]);
  });

  it("keeps a questionnaire out of a status that does not assign it", () => {
    expect(patientInstrument("screening", "hads-anxiety")).toBeUndefined();
    expect(patientInstrument("screening", "uku")).toBeUndefined();
    expect(patientInstrument("treatment", "hads-anxiety")?.id).toBe("hads-anxiety");
  });

  it("never gives a patient the doctor's scale", () => {
    expect(instrument("hdrs-17")?.audience).toBe("doctor");
    for (const status of PATIENT_STATUS_IDS) {
      expect(patientInstruments(status).map((item) => item.id)).not.toContain("hdrs-17");
      expect(patientInstrument(status, "hdrs-17")).toBeUndefined();
    }
  });

  it("refuses an unknown status instead of returning an empty set", () => {
    expect(() => patientInstruments("remission")).toThrow(UnknownStatus);
  });

  it("names a missing instrument file at the assembly, not on the patient's screen", () => {
    expect(() => assertStatusInstrumentsExist()).not.toThrow();
  });

  it("prefers the status interval over the instrument's own", () => {
    expect(instrument("phq-9")?.repeatAfterHours).toBe(168);
    // PHQ-9 — скрининг на входе: в терапии его нет, динамику ведут другие шкалы.
    expect(patientInstrument("treatment", "phq-9")).toBeUndefined();
    expect(repeatAfterHours("treatment", "uku")).toBe(168);
    expect(repeatAfterHours("treatment", "hads-depression")).toBe(168);
  });

  it("returns null for an instrument the status does not assign", () => {
    expect(repeatAfterHours("screening", "uku")).toBeNull();
    expect(repeatAfterHours("treatment", "phq-9")).toBeNull();
  });

  it("describes every assigned instrument's origin in text the patient can read", () => {
    for (const status of PATIENT_STATUS_IDS) {
      for (const assigned of patientInstruments(status)) {
        expect(assigned.source.note.length).toBeGreaterThan(20);
      }
    }
  });
});
