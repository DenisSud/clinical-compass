import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { instrumentSchema, type Instrument } from "./schema.js";

const DIRECTORY = import.meta.dirname;

let cache: Map<string, Instrument> | null = null;

/** Reads every *.json next to this file. A malformed file fails loudly at startup. */
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
