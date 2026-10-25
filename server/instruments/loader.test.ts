import { describe, expect, it } from "vitest";
import { patientInstrument, patientInstruments } from "./loader.js";

describe("the patient's set", () => {
  it("is exactly the free instruments from decisions.md Q29–Q30", () => {
    expect(patientInstruments().map((instrument) => instrument.id)).toEqual([
      "phq-9",
      "gad-7",
      "asq",
    ]);
  });

  it("has no HADS: it left the set altogether", () => {
    expect(patientInstrument("hads")).toBeUndefined();
  });

  it("does not make a doctor's form patient-facing just because it is a file", () => {
    expect(patientInstrument("c-ssrs")).toBeUndefined();
  });

  it("describes every instrument's origin in text the patient can read", () => {
    for (const instrument of patientInstruments()) {
      expect(instrument.source.note.length).toBeGreaterThan(20);
    }
  });
});
