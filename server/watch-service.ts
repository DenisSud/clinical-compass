import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { WatchItem } from "../shared/contracts.js";
import { watchItems } from "./db/schema.js";
import { instrument } from "./instruments/loader.js";
import { signalsForWatchItems, type WatchEvent } from "./rules/watch.js";
import { saveSignals } from "./routes/signals.js";

type Row = typeof watchItems.$inferSelect;

export function toWatchItem(row: Row): WatchItem {
  return {
    id: row.id,
    patientId: row.patientId,
    kind: row.kind as WatchItem["kind"],
    title: row.title,
    severity: row.severity as WatchItem["severity"],
    params: JSON.parse(row.params) as Record<string, unknown>,
    status: row.status as WatchItem["status"],
    createdAt: row.createdAt,
    pausedAt: row.pausedAt,
  };
}

/**
 * Правило суммы у шкалы без общей суммы не сработает никогда: строка могла остаться
 * в базе с тех пор, как отказ появился только на создании правила (#68, SPEC S10).
 */
export function hasComparableTotal(item: WatchItem): boolean {
  if (item.kind !== "score_threshold") return true;
  return instrument(String(item.params.instrumentId))?.scoring !== "items";
}

export async function activeWatchItems(app: FastifyInstance, patientId: string): Promise<WatchItem[]> {
  const rows = await app.conn.db
    .select()
    .from(watchItems)
    .where(and(eq(watchItems.patientId, patientId), eq(watchItems.status, "active")));
  return rows.map(toWatchItem);
}

/** Прогоняет правила врача по одному новому событию и сохраняет то, что сработало. */
export async function raiseWatchSignals(
  app: FastifyInstance,
  input: {
    patientId: string;
    sourceType: "assessment" | "diary" | "checkin" | "message";
    sourceId: string;
    event: WatchEvent;
  },
): Promise<void> {
  const items = await activeWatchItems(app, input.patientId);
  if (items.length === 0) return;

  const drafts = signalsForWatchItems(items, input.event);
  await saveSignals(app, {
    patientId: input.patientId,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    drafts,
  });
}
