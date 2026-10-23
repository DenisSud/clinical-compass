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
  intro: z.string().min(1),
  options: z.array(optionSchema).min(2),
  items: z.array(itemSchema).min(1),
  bands: z.array(bandSchema).min(1),
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
