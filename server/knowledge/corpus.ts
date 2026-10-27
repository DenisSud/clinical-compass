import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

const sourceSchema = z.object({
  publisher: z.string().min(1),
  url: z.string().url(),
  retrievedAt: z.string().min(1),
});

const smpcSchema = z.object({
  kind: z.literal("smpc"),
  id: z.string().min(1),
  title: z.string().min(1),
  inn: z.string().min(1),
  tradeNames: z.array(z.string()).default([]),
  source: sourceSchema,
  sections: z.object({
    indications: z.string().default(""),
    contraindications: z.string().default(""),
    dosing: z.string().default(""),
    interactions: z.string().default(""),
    warnings: z.string().default(""),
    adverseReactions: z.string().default(""),
  }),
});

const guidelineSchema = z.object({
  kind: z.literal("guideline"),
  id: z.string().min(1),
  title: z.string().min(1),
  source: sourceSchema,
  sections: z.object({
    recommendations: z.string().default(""),
    firstLine: z.string().default(""),
    referral: z.string().default(""),
  }),
});

export const documentSchema = z.discriminatedUnion("kind", [smpcSchema, guidelineSchema]);

export type KnowledgeDocument = z.infer<typeof documentSchema>;
export type SmpcDocument = z.infer<typeof smpcSchema>;
export type GuidelineDocument = z.infer<typeof guidelineSchema>;

const DIRECTORY = import.meta.dirname;

let cache: KnowledgeDocument[] | null = null;

/** Читает каждый *.json здесь. Сломанный файл падает громко: испорченный источник хуже, чем никакого. */
export function corpus(): KnowledgeDocument[] {
  if (cache) return cache;

  const documents: KnowledgeDocument[] = [];
  for (const file of readdirSync(DIRECTORY).filter((name) => name.endsWith(".json"))) {
    documents.push(documentSchema.parse(JSON.parse(readFileSync(join(DIRECTORY, file), "utf8"))));
  }

  cache = documents;
  return cache;
}

export function smpcByInn(): Map<string, SmpcDocument> {
  const index = new Map<string, SmpcDocument>();
  for (const document of corpus()) {
    if (document.kind === "smpc") index.set(document.inn.toLowerCase(), document);
  }
  return index;
}

export function guidelines(): GuidelineDocument[] {
  return corpus().filter((document): document is GuidelineDocument => document.kind === "guideline");
}
