import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { hashPassword } from "../auth/password.js";
import { createDb } from "./client.js";
import { score } from "../instruments/engine.js";
import { instrument } from "../instruments/loader.js";
import { assessments, diaryEntries, doctors, patients, planCheckins, planItems } from "./schema.js";

const DOCTOR_EMAIL = process.env.SEED_DOCTOR_EMAIL ?? "doctor@example.com";
const PASSWORD = process.env.SEED_PASSWORD ?? "compass-demo-2026";

const DEMO_PATIENTS = [
  { email: "anna@example.com", name: "Анна К.", boundDaysAgo: 21 },
  { email: "mikhail@example.com", name: "Михаил П.", boundDaysAgo: 6 },
];

const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

const { sqlite, db } = createDb(process.env.SQLITE_DB ?? "var/app.db");

let [doctor] = await db.select().from(doctors).where(eq(doctors.email, DOCTOR_EMAIL)).limit(1);

if (!doctor) {
  const passwordHash = await hashPassword(PASSWORD);
  [doctor] = await db
    .insert(doctors)
    .values({ id: randomUUID(), email: DOCTOR_EMAIL, passwordHash, name: "Доктор Демидов", createdAt: daysAgo(30) })
    .returning();
  console.log(`created doctor ${DOCTOR_EMAIL}`);
} else {
  console.log(`doctor ${DOCTOR_EMAIL} already exists`);
}

if (!doctor) throw new Error("doctor seed failed");

for (const demo of DEMO_PATIENTS) {
  const [existing] = await db.select().from(patients).where(eq(patients.email, demo.email)).limit(1);
  if (existing) {
    console.log(`patient ${demo.email} already exists`);
    continue;
  }
  await db.insert(patients).values({
    id: randomUUID(),
    email: demo.email,
    passwordHash: await hashPassword(PASSWORD),
    name: demo.name,
    doctorId: doctor.id,
    boundAt: daysAgo(demo.boundDaysAgo),
    createdAt: daysAgo(demo.boundDaysAgo + 2),
  });
  console.log(`created patient ${demo.email}`);
}

/** Demo history so the doctor's card has dynamics instead of empty tables. */
const PLAN: Record<string, { title: string }> = {
  "anna@example.com": { title: "Сертралин 50 мг" },
  "mikhail@example.com": { title: "Сертралин 25 мг" },
};

const PLAN_DRAFT: Record<string, string> = {
  "anna@example.com": "КПТ: 8 сессий",
  "mikhail@example.com": "Дневник тревоги дважды в день",
};

// 6 days since the prescription: three taken, one skipped with a reason, one day silent.
const PLAN_HISTORY: Record<string, { daysAgo: number; status: string; reason?: string }[]> = {
  "anna@example.com": [
    { daysAgo: 5, status: "done" },
    { daysAgo: 4, status: "done" },
    { daysAgo: 3, status: "skipped", reason: "Тошнило утром, пропустила приём" },
    { daysAgo: 2, status: "done" },
    { daysAgo: 1, status: "done" },
  ],
  "mikhail@example.com": [
    { daysAgo: 4, status: "done" },
    { daysAgo: 2, status: "skipped", reason: "Забыл взять таблетки на смену" },
  ],
};

const HISTORY: Record<string, { answers: Record<string, number>; daysAgo: number }[]> = {
  "anna@example.com": [
    {
      daysAgo: 21,
      answers: { q1: 1, q2: 2, q3: 1, q4: 2, q5: 1, q6: 2, q7: 1, q8: 1, q9: 0 },
    },
    {
      daysAgo: 14,
      answers: { q1: 1, q2: 1, q3: 1, q4: 1, q5: 1, q6: 1, q7: 1, q8: 1, q9: 0 },
    },
  ],
  "mikhail@example.com": [
    {
      daysAgo: 12,
      answers: { q1: 1, q2: 2, q3: 1, q4: 1, q5: 1, q6: 0, q7: 1, q8: 0, q9: 0 },
    },
  ],
};

const DIARY_HISTORY: Record<string, { daysAgo: number; value: number; comment: string | null }[]> = {
  "anna@example.com": [
    { daysAgo: 5, value: 4, comment: "Тяжело вставать по утрам" },
    { daysAgo: 4, value: 5, comment: null },
    { daysAgo: 3, value: 5, comment: "Погуляла, стало легче" },
    { daysAgo: 2, value: 6, comment: null },
    { daysAgo: 1, value: 7, comment: "Спал лучше" },
  ],
  "mikhail@example.com": [
    { daysAgo: 3, value: 7, comment: null },
    { daysAgo: 2, value: 6, comment: "Много работы" },
    { daysAgo: 1, value: 8, comment: null },
  ],
};

const phq9 = instrument("phq-9");
if (!phq9) throw new Error("phq-9 missing");

for (const demo of DEMO_PATIENTS) {
  const [patient] = await db.select().from(patients).where(eq(patients.email, demo.email)).limit(1);
  if (!patient) continue;

  const [hasAssessment] = await db
    .select({ id: assessments.id })
    .from(assessments)
    .where(eq(assessments.patientId, patient.id))
    .limit(1);

  if (!hasAssessment) {
    for (const entry of HISTORY[demo.email] ?? []) {
      const scored = score(phq9, entry.answers);
      const submittedAt = daysAgo(entry.daysAgo);
      await db.insert(assessments).values({
        id: randomUUID(),
        patientId: patient.id,
        instrumentId: phq9.id,
        instrumentVersion: phq9.version,
        answers: JSON.stringify(entry.answers),
        totalScore: scored.total,
        bandId: scored.band.id,
        bandLabel: scored.band.label,
        submissionId: `seed-${patient.id}-${entry.daysAgo}`,
        submittedAt,
        createdAt: submittedAt,
      });
    }
    console.log(`added assessment history for ${demo.email}`);
  }

  const [hasDiary] = await db
    .select({ id: diaryEntries.id })
    .from(diaryEntries)
    .where(eq(diaryEntries.patientId, patient.id))
    .limit(1);

  if (!hasDiary) {
    for (const entry of DIARY_HISTORY[demo.email] ?? []) {
      const createdAt = daysAgo(entry.daysAgo);
      await db.insert(diaryEntries).values({
        id: randomUUID(),
        patientId: patient.id,
        entryDate: createdAt.slice(0, 10),
        value: entry.value,
        comment: entry.comment,
        submissionId: `seed-${patient.id}-diary-${entry.daysAgo}`,
        createdAt,
      });
    }
    console.log(`added diary history for ${demo.email}`);
  }

  const [hasPlan] = await db
    .select({ id: planItems.id })
    .from(planItems)
    .where(eq(planItems.patientId, patient.id))
    .limit(1);

  if (!hasPlan) {
    const confirmedAt = daysAgo(6);
    const itemId = randomUUID();
    await db.insert(planItems).values({
      id: itemId,
      patientId: patient.id,
      kind: "medication",
      title: PLAN[demo.email]?.title ?? "Сертралин 50 мг",
      details: "Утром, после еды",
      status: "active",
      createdAt: confirmedAt,
      confirmedAt,
    });

    // Done, skipped and a day nobody answered — all three states in the demo.
    for (const day of PLAN_HISTORY[demo.email] ?? []) {
      const createdAt = daysAgo(day.daysAgo);
      await db.insert(planCheckins).values({
        id: randomUUID(),
        planItemId: itemId,
        patientId: patient.id,
        checkinDate: createdAt.slice(0, 10),
        status: day.status,
        reason: day.reason ?? null,
        createdAt,
      });
    }

    await db.insert(planItems).values({
      id: randomUUID(),
      patientId: patient.id,
      kind: "therapy",
      title: PLAN_DRAFT[demo.email] ?? "КПТ: 8 сессий",
      details: "Черновик, пациент его не видит",
      status: "draft",
      createdAt: daysAgo(1),
    });

    console.log(`added plan and adherence history for ${demo.email}`);
  }
}

sqlite.close();
console.log(`\nвход для демо: ${DOCTOR_EMAIL} / ${PASSWORD}`);
console.log(`пациенты: ${DEMO_PATIENTS.map((p) => p.email).join(", ")} / ${PASSWORD}`);
