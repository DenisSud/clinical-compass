import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { instrumentSchema, type Instrument } from "./schema.js";
import { instrumentsForStatus, statuses } from "./statuses.js";

const DIRECTORY = import.meta.dirname;

let cache: Map<string, Instrument> | null = null;

/** Читает каждый *.json рядом с этим файлом. Сломанный файл падает громко при старте. */
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
 * Набор пациента берётся из его статуса, а не из списка в коде: какие опросники видит
 * пациент, врач решает клинически одним маркером, а соответствие это файл данных
 * (content/instrument-statuses.json).
 *
 * Статус, который называет инструмент без файла, падает здесь по имени, вместо того чтобы
 * нарисовать более короткий список, чем назначил врач. Каждый пациентский маршрут получает
 * инструмент здесь, поэтому шкала врача (audience «doctor») проходить не должна: статус,
 * который её назначает, это сломанный файл, а не опросник, который пациент может видеть (SPEC S10).
 */
export function patientInstruments(status: string): Instrument[] {
  return instrumentsForStatus(status).map(({ id }) => {
    const found = instruments().get(id);
    if (!found) throw new Error(`статус ${status}: у опросника ${id} нет файла`);
    if (found.audience === "doctor") {
      throw new Error(`статус ${status}: опросник ${id} заполняет врач, а не пациент`);
    }
    return found;
  });
}

/**
 * Как скоро инструмент откроется снова в этом статусе. Назначение главнее собственного
 * интервала инструмента, поэтому файл статуса может сократить ожидание или убрать его,
 * не трогая файл шкалы.
 *
 * Null означает, что статус его не назначает. Маршрут отправки null не видит: он сначала
 * получает инструмент через статус, а список истории видит и откатывается к собственному
 * интервалу инструмента вместо отказа.
 */
export function repeatAfterHours(status: string, instrumentId: string): number | null {
  const entry = instrumentsForStatus(status).find((candidate) => candidate.id === instrumentId);
  return entry ? entry.repeatAfterHours : null;
}

/** Никогда не возвращает инструмент вне статуса пациента: пациентские маршруты получают его здесь. */
export function patientInstrument(status: string, id: string): Instrument | undefined {
  return patientInstruments(status).find((candidate) => candidate.id === id);
}

/**
 * Шкалы, которые заполняет врач (SPEC S9/S10, Q53). Набор этапа их не перечисляет:
 * HDRS-17 заполняется после приёма, и назначает его приём, а не статус пациента.
 */
export function doctorInstruments(): Instrument[] {
  return [...instruments().values()].filter((instrument) => instrument.audience === "doctor");
}

/**
 * Вызывается при старте: файл статуса, который называет отсутствующий инструмент, или шкала
 * врача, не должны ждать пациента. Проверка это тот же расчёт набора, которым пользуется
 * маршрут пациента, поэтому сборка падает там же, где упал бы запрос.
 */
export function assertStatusInstrumentsExist(): void {
  for (const status of statuses().keys()) patientInstruments(status);
}
