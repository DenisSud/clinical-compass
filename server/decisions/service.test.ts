import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { assessments, doseEvents, prescriptions, signals } from "../db/schema.js";
import {
  plannedSlots,
  shiftDay,
  slotState,
  wallClockDay,
  wallClockMinute,
} from "../prescriptions/schedule.js";
import { newApp, signUpPatient, type App } from "../test-support.js";
import { runDecisionQuestions } from "./service.js";

const DECISION_KIND = "decision:worsening-with-missed-doses";

/** Прошлая отправка PHQ-9 и текущая: рост на 9 баллов — условие любого вопроса об ухудшении. */
async function seedWorsening(app: App, patientId: string) {
  const now = Date.now();
  await app.conn.db.insert(assessments).values([
    {
      id: randomUUID(),
      patientId,
      instrumentId: "phq-9",
      instrumentVersion: "1.0.0",
      answers: JSON.stringify(Object.fromEntries(Array.from({ length: 9 }, (_, index) => [`q${index + 1}`, 1]))),
      totalScore: 9,
      bandId: "mild",
      bandLabel: "Лёгкие проявления",
      submissionId: "past",
      submittedAt: new Date(now - 7 * 24 * 3600 * 1000).toISOString(),
      createdAt: new Date(now - 7 * 24 * 3600 * 1000).toISOString(),
    },
    {
      id: randomUUID(),
      patientId,
      instrumentId: "phq-9",
      instrumentVersion: "1.0.0",
      answers: JSON.stringify(Object.fromEntries(Array.from({ length: 9 }, (_, index) => [`q${index + 1}`, 2]))),
      totalScore: 18,
      bandId: "moderately_severe",
      bandLabel: "Умеренно тяжёлые проявления",
      submissionId: "now",
      submittedAt: new Date(now).toISOString(),
      createdAt: new Date(now).toISOString(),
    },
  ]);
}

/**
 * Пропуски подряд по *состоявшимся* слотам: последние n наступивших приёмов — пропуски,
 * более ранние — приняты. Так тест не зависит от времени суток, а цепочка считается
 * тем же `slotState`, что и в продукте.
 */
async function seedAdherence(app: App, patientId: string, skipped: number) {
  const now = new Date();
  const today = wallClockDay(now);
  const prescriptionId = randomUUID();
  const startsOn = shiftDay(today, -6);

  await app.conn.db.insert(prescriptions).values({
    id: prescriptionId,
    patientId,
    drugId: null,
    drugName: "Авиандр",
    doseValue: 20,
    doseUnit: "мг",
    timesPerDay: 1,
    timesOfDay: JSON.stringify(["08:00"]),
    startsOn,
    endsOn: null,
    status: "active",
    createdAt: new Date().toISOString(),
    confirmedAt: new Date().toISOString(),
    confirmedBy: null,
    archivedAt: null,
  });

  const elapsed = plannedSlots({ startsOn, endsOn: today, timesOfDay: ["08:00"] }, startsOn, today).filter(
    (scheduledAt) => slotState({ scheduledAt, mark: undefined, now: wallClockMinute(now) }) !== "scheduled",
  );
  const firstSkipped = elapsed.length - skipped;

  await app.conn.db.insert(doseEvents).values(
    elapsed.map((scheduledAt, index) => ({
      id: randomUUID(),
      prescriptionId,
      patientId,
      scheduledAt,
      status: index >= firstSkipped ? "skipped" : "taken",
      takenAt: index >= firstSkipped ? null : new Date().toISOString(),
      reason: index >= firstSkipped ? "уехал" : null,
      createdAt: new Date().toISOString(),
    })),
  );
}

async function decisionSignals(app: App, patientId: string) {
  return app.conn.db
    .select()
    .from(signals)
    .where(and(eq(signals.patientId, patientId), eq(signals.kind, DECISION_KIND)));
}

describe("questions on an event", () => {
  it("raises the decision card when worsening meets missed doses", async () => {
    const app = await newApp();
    const cookie = await signUpPatient(app);
    const me = await app.inject({ method: "GET", url: "/api/me", headers: { cookie } });
    const patientId = me.json().profile.id as string;

    await seedWorsening(app, patientId);
    await seedAdherence(app, patientId, 3);

    await runDecisionQuestions(app, { patientId, sourceType: "assessment", sourceId: "now" });

    const raised = await decisionSignals(app, patientId);
    expect(raised).toHaveLength(1);
    expect(raised[0]?.ruleId).toBe("worsening-with-missed-doses");
    expect(raised[0]?.detail).toContain("Пропусков приёма подряд — 3");
    await app.close();
  });

  it("does not raise a card when the system has no adherence data", async () => {
    const app = await newApp();
    const cookie = await signUpPatient(app);
    const me = await app.inject({ method: "GET", url: "/api/me", headers: { cookie } });
    const patientId = me.json().profile.id as string;

    await seedWorsening(app, patientId);
    await runDecisionQuestions(app, { patientId, sourceType: "assessment", sourceId: "now" });

    expect(await decisionSignals(app, patientId)).toHaveLength(0);
    await app.close();
  });

  it("keeps one card when the same event is replayed", async () => {
    const app = await newApp();
    const cookie = await signUpPatient(app);
    const me = await app.inject({ method: "GET", url: "/api/me", headers: { cookie } });
    const patientId = me.json().profile.id as string;

    await seedWorsening(app, patientId);
    await seedAdherence(app, patientId, 3);

    await runDecisionQuestions(app, { patientId, sourceType: "assessment", sourceId: "now" });
    await runDecisionQuestions(app, { patientId, sourceType: "assessment", sourceId: "now" });

    expect(await decisionSignals(app, patientId)).toHaveLength(1);
    await app.close();
  });
});
