import type { Draft, TherapyCard } from "../../shared/contracts.js";

/**
 * The seam where a model will sit. Slice 1 shipped this declaration and no
 * implementation, so nothing could call a model by accident; the port now carries
 * the shape the doctor actually needs on screen.
 *
 * Every method returns a Draft: a proposal with no clinical effect until a doctor
 * confirms it. That rule lives in the type, not in a prompt.
 */
export type ClinicalAssistant = {
  summarizeHistory(input: { patientId: string }): Promise<Draft<string>>;
  draftConclusion(input: { patientId: string }): Promise<Draft<string>>;
  extractFacts(input: { patientId: string }): Promise<Draft<Record<string, string>>>;
  /**
   * Recommendation cards. Each one must say what it rests on (`basis`) and what is
   * still missing to decide (`missing`). A card with an empty basis is a bug, not a
   * style choice: the case requires every recommendation to explain itself.
   */
  suggestTherapy(input: { patientId: string }): Promise<Draft<TherapyCard[]>>;
};
