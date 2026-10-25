import { z } from "zod";

const optionSchema = z.object({
  value: z.number().int().nonnegative(),
  label: z.string().min(1),
});

const itemSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  critical: z.boolean().default(false),
});

const bandSchema = z.object({
  id: z.string().min(1),
  min: z.number().int().nonnegative(),
  max: z.number().int().nonnegative(),
  label: z.string().min(1),
});

/**
 * The description of an instrument is data, not code. Adding the next
 * questionnaire means adding a file here, not a route.
 */
export const instrumentSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  title: z.string().min(1),
  /**
   * Как шкалу называть на карточке врача: полное имя для карточки слишком длинное,
   * а «16 из 27» без имени заставляет угадывать инструмент по максимуму (Q24).
   */
  shortTitle: z.string().min(1).optional(),
  intro: z.string().min(1),
  options: z.array(optionSchema).min(2),
  items: z.array(itemSchema).min(1),
  bands: z.array(bandSchema).min(1),
  /**
   * How soon the instrument may be asked again. Zero means any time: a risk
   * screener must not be locked for a week because the patient answered «нет»
   * on Monday and is in crisis on Wednesday (DESIGN.md §2.1).
   */
  repeatAfterHours: z.number().int().nonnegative().default(168),
  /** Which band is worth a signal. Clinical policy about this instrument, so it lives in the data. */
  alert: z
    .object({
      bandId: z.string().min(1),
      /**
       * Whether the band also earns a total-score signal. False where the band is
       * not a severity: ASQ counts affirmative answers, and those are already
       * carried by the critical-item rule. Two cards for one answer read as two
       * findings.
       */
      totalSignal: z.boolean().default(true),
    })
    .optional(),
  source: z.object({
    authors: z.string().min(1),
    validation_citation: z.string().nullable(),
    licence: z.string().min(1),
    note: z.string().default(""),
  }),
});

export type Instrument = z.infer<typeof instrumentSchema>;
export type InstrumentItem = z.infer<typeof itemSchema>;
export type InstrumentBand = z.infer<typeof bandSchema>;
