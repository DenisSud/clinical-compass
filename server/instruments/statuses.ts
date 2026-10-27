import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { ruleSourceSchema } from "../../shared/rules.js";

/**
 * Статус пациента — рабочая пометка врача, а не оценка тяжести: «скрининг»,
 * «терапия», «ухудшение». Он выбирает набор опросников и частоту, с которой они
 * открываются, поэтому живёт в файле данных: материал Антона по выбору шкал
 * заменяет содержимое файла, а не код (decisions.md Q47, SPEC.md S3/S12).
 *
 * Пациент статус не видит: «ухудшение» — интерпретация, а пациент получает только
 * список опросников (DESIGN.md §2.2).
 */
export const PATIENT_STATUS_IDS = ["screening", "treatment", "worsening"] as const;
export type PatientStatusId = (typeof PATIENT_STATUS_IDS)[number];

/** A status that is not in the list above is a typo in the database, not a fourth status. */
export class UnknownStatus extends Error {}

const statusInstrumentSchema = z.strictObject({
  id: z.string().min(1),
  /**
   * How soon this instrument opens again *in this status*. The schedule belongs to
   * the assignment, not to the instrument: HADS-тревога opens weekly in treatment and
   * every three days once the doctor marks worsening. Zero keeps the instrument's own
   * "any time" meaning (ASQ).
   */
  repeatAfterHours: z.number().int().nonnegative(),
});

const patientStatusSchema = z.strictObject({
  id: z.enum(PATIENT_STATUS_IDS),
  /** What the doctor reads on the card. Never shown to the patient. */
  label: z.string().min(1),
  instruments: z.array(statusInstrumentSchema).min(1),
  /** Same honesty marker as a rule source: ours until the clinical material arrives. */
  source: ruleSourceSchema,
});

const statusesFileSchema = z.strictObject({
  statuses: z.array(patientStatusSchema).min(1),
});

export type StatusInstrument = z.infer<typeof statusInstrumentSchema>;
export type PatientStatus = z.infer<typeof patientStatusSchema>;

const FILE = join(import.meta.dirname, "..", "..", "content", "instrument-statuses.json");

let cache: Map<PatientStatusId, PatientStatus> | null = null;

/**
 * Validates the file's content. Separated from the reading so the failure modes are
 * testable without writing files: a status with no instruments, an instrument twice,
 * a source that is absent.
 */
export function parseStatusesFile(value: unknown): Map<PatientStatusId, PatientStatus> {
  const parsed = statusesFileSchema.safeParse(value);
  if (!parsed.success) {
    const reason = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(корень)"}: ${issue.message}`)
      .join("; ");
    throw new Error(`файл статусов не прошёл схему — ${reason}`);
  }

  const loaded = new Map<PatientStatusId, PatientStatus>();
  for (const status of parsed.data.statuses) {
    if (loaded.has(status.id)) throw new Error(`статус ${status.id} объявлен дважды`);

    const seen = new Set<string>();
    for (const entry of status.instruments) {
      if (seen.has(entry.id)) {
        throw new Error(`статус ${status.id}: опросник ${entry.id} указан дважды`);
      }
      seen.add(entry.id);
    }

    loaded.set(status.id, status);
  }

  for (const id of PATIENT_STATUS_IDS) {
    if (!loaded.has(id)) throw new Error(`статус ${id} не описан в файле статусов`);
  }

  return loaded;
}

/** Reads the status file once. A malformed file fails loudly instead of emptying a screen. */
export function statuses(): Map<PatientStatusId, PatientStatus> {
  if (cache) return cache;
  cache = parseStatusesFile(JSON.parse(readFileSync(FILE, "utf8")));
  return cache;
}

/** Throws for a status the file does not describe: an unknown status must not read as an empty set. */
export function patientStatus(id: string): PatientStatus {
  const found = statuses().get(id as PatientStatusId);
  if (!found) throw new UnknownStatus(`неизвестный статус пациента: ${id}`);
  return found;
}

export function instrumentsForStatus(id: string): StatusInstrument[] {
  return patientStatus(id).instruments;
}

export function statusLabel(id: string): string {
  return patientStatus(id).label;
}

/** Test seam: drops the cache so a test can reload a file it just wrote. */
export function resetStatusesForTests(): void {
  cache = null;
}
