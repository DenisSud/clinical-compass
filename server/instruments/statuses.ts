import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { DoctorSpecialty } from "../../shared/contracts.js";
import { ruleSourceSchema } from "../../shared/rules.js";

/**
 * Этап пациента — рабочая пометка врача, а не оценка тяжести: «скрининг» или
 * «терапия». Он выбирает набор опросников и частоту, с которой они открываются,
 * поэтому живёт в файле данных: материал Антона по выбору шкал заменяет содержимое
 * файла, а не код (decisions.md Q47, SPEC.md S3/S12).
 *
 * Этапов два, и третий переключатель не появится: «ухудшение» — сигнал, а не этап
 * (Q49). Этап следует из специальности ведущего врача, отдельной кнопки нет (S3).
 * Пациент этап не видит: это интерпретация, а пациент получает только список
 * опросников (DESIGN.md §2.2).
 */
export const PATIENT_STATUS_IDS = ["screening", "treatment"] as const;
export type PatientStatusId = (typeof PATIENT_STATUS_IDS)[number];

/**
 * Этап из специальности ведущего врача: у терапевта скрининг, у психиатра терапия
 * (SPEC S3, Q49). Одна функция на все входы — привязку и площадку, — чтобы этап не
 * считался в двух местах по-разному.
 */
export function statusForSpecialty(specialty: DoctorSpecialty): PatientStatusId {
  return specialty === "psychiatrist" ? "treatment" : "screening";
}

/** Статус, которого нет в списке выше, это опечатка в базе, а не четвёртый статус. */
export class UnknownStatus extends Error {}

const statusInstrumentSchema = z.strictObject({
  id: z.string().min(1),
  /**
   * Как скоро этот инструмент откроется снова *в этом статусе*. Расписание принадлежит
   * назначению, а не инструменту: одна и та же шкала может открываться в разных этапах
   * с разным периодом. Ноль сохраняет смысл «в любой момент».
   */
  repeatAfterHours: z.number().int().nonnegative(),
});

const patientStatusSchema = z.strictObject({
  id: z.enum(PATIENT_STATUS_IDS),
  /** То, что врач читает на карточке. Пациенту не показывается никогда. */
  label: z.string().min(1),
  instruments: z.array(statusInstrumentSchema).min(1),
  /** Тот же маркер честности, что у источника правила: наше, пока не пришёл клинический материал. */
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
 * Проверяет содержимое файла. Отделено от чтения, чтобы отказы были проверяемы без записи
 * файлов: статус без инструментов, инструмент дважды, отсутствующий источник.
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

/** Читает файл статусов один раз. Сломанный файл падает громко вместо того, чтобы опустошить экран. */
export function statuses(): Map<PatientStatusId, PatientStatus> {
  if (cache) return cache;
  cache = parseStatusesFile(JSON.parse(readFileSync(FILE, "utf8")));
  return cache;
}

/** Бросает на статусе, которого файл не описывает: неизвестный статус не должен читаться как пустой набор. */
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

/** Шов для тестов: сбрасывает кеш, чтобы тест перечитал только что записанный файл. */
export function resetStatusesForTests(): void {
  cache = null;
}
