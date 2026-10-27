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
      "asq",
    ]);
  });

  it("keeps a questionnaire out of a status that does not assign it", () => {
    expect(patientInstrument("screening", "hads-anxiety")).toBeUndefined();
    expect(patientInstrument("screening", "asq")).toBeUndefined();
    expect(patientInstrument("treatment", "hads-anxiety")?.id).toBe("hads-anxiety");
  });

  it("refuses an unknown status instead of returning an empty set", () => {
    expect(() => patientInstruments("remission")).toThrow(UnknownStatus);
  });

  it("names a missing instrument file at the assembly, not on the patient's screen", () => {
    expect(() => assertStatusInstrumentsExist()).not.toThrow();
  });

  it("prefers the status interval over the instrument's own", () => {
    expect(instrument("phq-9")?.repeatAfterHours).toBe(168);
    // PHQ-9 — скрининг на входе: в терапии и ухудшении его нет, динамику ведут другие шкалы.
    expect(patientInstrument("treatment", "phq-9")).toBeUndefined();
    expect(repeatAfterHours("worsening", "hads-anxiety")).toBe(72);
    expect(repeatAfterHours("worsening", "asq")).toBe(0);
  });

  it("returns null for an instrument the status no longer assigns", () => {
    expect(repeatAfterHours("worsening", "c-ssrs")).toBeNull();
  });

  it("describes every assigned instrument's origin in text the patient can read", () => {
    for (const status of PATIENT_STATUS_IDS) {
      for (const assigned of patientInstruments(status)) {
        expect(assigned.source.note.length).toBeGreaterThan(20);
      }
    }
  });
});
