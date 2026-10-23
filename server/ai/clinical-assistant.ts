import type { Draft } from "../../shared/contracts.js";

/**
 * The seam where a model will sit. Slice 1 ships this declaration and no
 * implementation, so nothing can call a model by accident.
 *
 * Every method returns a Draft: a proposal with no clinical effect until a
 * doctor confirms it. That rule lives in the type, not in a prompt.
 */
export type ClinicalAssistant = {
  summarizeHistory(input: { patientId: string }): Promise<Draft<string>>;
  draftConclusion(input: { patientId: string }): Promise<Draft<string>>;
  extractFacts(input: { patientId: string }): Promise<Draft<Record<string, string>>>;
  suggestTherapy(input: { patientId: string }): Promise<Draft<string[]>>;
};
