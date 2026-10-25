import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { instrumentSchema, type Instrument } from "./schema.js";

const DIRECTORY = import.meta.dirname;

/**
 * The patient's set. A file in this directory is not enough to make an instrument
 * patient-facing: C-SSRS stays a form the doctor fills in (decisions.md Q29), and HADS
 * is gone altogether (Q30). An id listed here with no file fails at startup, not on
 * the patient's screen.
 */
const PATIENT_INSTRUMENT_IDS = ["phq-9", "gad-7", "asq"];

let cache: Map<string, Instrument> | null = null;

/** Reads every *.json next to this file. A malformed file fails loudly at startup. */
export function instruments(): Map<string, Instrument> {
  if (cache) return cache;

  const loaded = new Map<string, Instrument>();
  for (const file of readdirSync(DIRECTORY).filter((name) => name.endsWith(".json"))) {
    const parsed = instrumentSchema.parse(JSON.parse(readFileSync(join(DIRECTORY, file), "utf8")));
    if (loaded.has(parsed.id)) throw new Error(`instrument ${parsed.id} declared twice`);
    loaded.set(parsed.id, parsed);
  }

  if (loaded.size === 0) throw new Error("no instruments found");
  cache = loaded;
  return cache;
}

export function instrument(id: string): Instrument | undefined {
  return instruments().get(id);
}

/** Everything the patient may fill in, in the set order. */
export function patientInstruments(): Instrument[] {
  return PATIENT_INSTRUMENT_IDS.map((id) => {
    const found = instruments().get(id);
    if (!found) throw new Error(`patient instrument ${id} has no file`);
    return found;
  });
}

/** Never returns a doctor-only instrument: the patient routes resolve through here. */
export function patientInstrument(id: string): Instrument | undefined {
  return patientInstruments().find((candidate) => candidate.id === id);
}
