import type { PatientFacts } from "../shared/contracts.js";
import type { patientFacts } from "./db/schema.js";

type FactsRow = typeof patientFacts.$inferSelect;

/**
 * Строка фактов → контракт «не спрашивали = null». NULL остаётся NULL: пропуск в
 * форме не равен ответу «нет», и правило на неизвестном факте не срабатывает (Q36).
 */
export function toFacts(row: FactsRow | undefined): PatientFacts {
  return {
    epilepsyOrOrganicBrainDisease:
      (row?.epilepsyOrOrganicBrainDisease as PatientFacts["epilepsyOrOrganicBrainDisease"]) ?? null,
    maoInhibitors: (row?.maoInhibitors as PatientFacts["maoInhibitors"]) ?? null,
    egfrMlMin: row?.egfrMlMin ?? null,
    childPugh: (row?.childPugh as PatientFacts["childPugh"]) ?? null,
    pregnancy: (row?.pregnancy as PatientFacts["pregnancy"]) ?? null,
    galactoseIntolerance:
      (row?.galactoseIntolerance as PatientFacts["galactoseIntolerance"]) ?? null,
  };
}
