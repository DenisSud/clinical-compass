import { z } from "zod";

const optionSchema = z.object({
  value: z.number().int().nonnegative(),
  label: z.string().min(1),
});

const itemSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  critical: z.boolean().default(false),
  /**
   * Свои варианты ответа у пункта: в HADS и UKU формулировки разные в каждом пункте, и
   * общей шкалы «0–3» у них нет. У PHQ-9 варианты общие, поэтому ему хватает поля ниже.
   */
  options: z.array(optionSchema).min(2).optional(),
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
  /**
   * Кто заполняет шкалу. HDRS-17 заполняет врач после приёма, и пациент её не видит
   * (SPEC S9/S10), поэтому аудитория — свойство файла шкалы, а не список id в коде.
   * По умолчанию шкала пациентская: новая шкала без поля ведёт себя как PHQ-9/HADS/UKU.
   */
  audience: z.enum(["patient", "doctor"]).default("patient"),
  title: z.string().min(1),
  /**
   * Как шкалу называть на карточке врача: полное имя для карточки слишком длинное,
   * а «16 из 27» без имени заставляет угадывать инструмент по максимуму (Q24).
   */
  shortTitle: z.string().min(1).optional(),
  intro: z.string().min(1),
  options: z.array(optionSchema).min(2).optional(),
  items: z.array(itemSchema).min(1),
  bands: z.array(bandSchema).min(1),
  /**
   * How soon the instrument may be asked again unless the status says otherwise.
   * Zero means any time: шкалу с риском нельзя запирать на неделю из-за ответа
   * в понедельник (DESIGN.md §2.1).
   */
  repeatAfterHours: z.number().int().nonnegative().default(168),
  /** Which band is worth a signal. Clinical policy about this instrument, so it lives in the data. */
  alert: z
    .object({
      bandId: z.string().min(1),
      /**
       * Whether the band also earns a total-score signal. False where the band is
       * not a severity: у UKU общей суммы нет, складывать разные явления в одно
       * число запрещено (SPEC S10), и карточка по «сумме» была бы выдумкой.
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

/** Варианты ответа пункта: свои, если заданы, иначе общие для шкалы. */
export function optionsOf(
  instrument: Pick<z.infer<typeof instrumentSchema>, "options">,
  item: Pick<z.infer<typeof itemSchema>, "options" | "id">,
): z.infer<typeof optionSchema>[] {
  const options = item.options ?? instrument.options;
  if (!options) throw new Error(`у пункта ${item.id} нет вариантов ответа`);
  return options;
}

export type Instrument = z.infer<typeof instrumentSchema>;
export type InstrumentItem = z.infer<typeof itemSchema>;
export type InstrumentBand = z.infer<typeof bandSchema>;
