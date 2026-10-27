import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { instrumentSchema, type Instrument } from "./schema.js";
import { instrumentsForStatus, statuses } from "./statuses.js";

const DIRECTORY = import.meta.dirname;

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

/**
 * The patient's set comes from their status, not from a list in code: which
 * questionnaires a patient sees is a clinical decision the doctor makes with one
 * marker, and the mapping is a data file (content/instrument-statuses.json).
 *
 * A status that names an instrument with no file fails here, by name, instead of
 * rendering a shorter list than the doctor prescribed. Doctor-only instruments
 * still never reach a patient route: they are not listed in any status.
 */
export function patientInstruments(status: string): Instrument[] {
  return instrumentsForStatus(status).map(({ id }) => {
    const found = instruments().get(id);
    if (!found) throw new Error(`статус ${status}: у опросника ${id} нет файла`);
    return found;
  });
}

/**
 * How soon the instrument opens again in this status. The assignment wins over the
 * instrument's own interval: the same questionnaire is monthly in treatment and
 * weekly when the doctor marks the patient as worsening.
 *
 * Null means the status does not assign it. The submission route never sees null —
 * it resolves the instrument through the status first — but the history listing does,
 * and it falls back to the instrument's own interval instead of failing.
 */
export function repeatAfterHours(status: string, instrumentId: string): number | null {
  const entry = instrumentsForStatus(status).find((candidate) => candidate.id === instrumentId);
  return entry ? entry.repeatAfterHours : null;
}

/** Never returns an instrument outside the patient's status: the patient routes resolve through here. */
export function patientInstrument(status: string, id: string): Instrument | undefined {
  return patientInstruments(status).find((candidate) => candidate.id === id);
}

/** Called at startup: a status file that names a missing instrument must not wait for a patient. */
export function assertStatusInstrumentsExist(): void {
  for (const status of statuses().values()) {
    for (const entry of status.instruments) {
      if (!instruments().has(entry.id)) {
        throw new Error(`статус ${status.id}: у опросника ${entry.id} нет файла`);
      }
    }
  }
}
