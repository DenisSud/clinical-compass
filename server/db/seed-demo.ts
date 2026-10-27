import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { hashPassword } from "../auth/password.js";
import type { Db } from "./client.js";
import { score } from "../instruments/engine.js";
import { instrument } from "../instruments/loader.js";
import {
  assessments,
  diaryEntries,
  doctors,
  patients,
  planCheckins,
  planItems,
  watchItems,
} from "./schema.js";

/**
 * Демо-состояние продукта: психиатр с двумя привязанными пациентами на этапе терапии.
 * Раньше засеянный врач был терапевтом, и демо не показывало ни HDRS-17, ни приёмов,
 * ни назначений: они открываются только психиатру на этапе терапии (SPEC S3, Q49).
 *
 * Вынесено из CLI, чтобы тест проверял то же самое состояние, а не его описание.
 */
export const SEED_DOCTOR_EMAIL = process.env.SEED_DOCTOR_EMAIL ?? "doctor@example.com";
export const SEED_PASSWORD = process.env.SEED_PASSWORD ?? "compass-demo-2026";

export const DEMO_PATIENTS = [
  { email: "anna@example.com", name: "Анна К.", boundDaysAgo: 21 },
  { email: "mikhail@example.com", name: "Михаил П.", boundDaysAgo: 6 },
];

const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

export async function seedDemo(db: Db["db"], log: (line: string) => void = console.log): Promise<void> {


  let [doctor] = await db.select().from(doctors).where(eq(doctors.email, SEED_DOCTOR_EMAIL)).limit(1);

  if (!doctor) {
    const passwordHash = await hashPassword(SEED_PASSWORD);
    [doctor] = await db
      .insert(doctors)
      .values({
        id: randomUUID(),
        email: SEED_DOCTOR_EMAIL,
        passwordHash,
        name: "Доктор Демидов",
        // Демо показывает психиатрию: только её пациенты получают HDRS-17, приёмы и назначения.
        specialty: "psychiatrist",
        createdAt: daysAgo(30),
      })
      .returning();
    log(`создан врач ${SEED_DOCTOR_EMAIL} со специальностью «психиатр»`);
  } else if (doctor.specialty !== "psychiatrist") {
    // Засеянный раньше терапевт оставил бы демо без врачебной части.
    const previous = doctor.specialty;
    [doctor] = await db
      .update(doctors)
      .set({ specialty: "psychiatrist" })
      .where(eq(doctors.id, doctor.id))
      .returning();
    log(`врач ${SEED_DOCTOR_EMAIL}: специальность «психиатр» вместо «${previous}»`);
  } else {
    log(`врач ${SEED_DOCTOR_EMAIL} уже есть, специальность «психиатр»`);
  }

  if (!doctor) throw new Error("демо-врач не создан");

  for (const demo of DEMO_PATIENTS) {
    const [existing] = await db.select().from(patients).where(eq(patients.email, demo.email)).limit(1);
    if (existing) {
      // Старый засев оставлял пациента без этапа: доводим его до терапии, иначе демо пустое.
      await db
        .update(patients)
        .set({
          doctorId: doctor.id,
          boundAt: existing.boundAt ?? daysAgo(demo.boundDaysAgo),
          status: "treatment",
        })
        .where(eq(patients.id, existing.id));
      log(`пациент ${demo.email} привязан, этап «терапия»`);
      continue;
    }
    await db.insert(patients).values({
      id: randomUUID(),
      email: demo.email,
      passwordHash: await hashPassword(SEED_PASSWORD),
      name: demo.name,
      doctorId: doctor.id,
      boundAt: daysAgo(demo.boundDaysAgo),
      // Терапия следует из специальности врача (SPEC S3, Q49), а не из флага в демо.
      status: "treatment",
      createdAt: daysAgo(demo.boundDaysAgo + 2),
    });
    log(`создан пациент ${demo.email}, этап «терапия»`);
  }

  /** Демо-история, чтобы в карточке врача была динамика, а не пустые таблицы. */
  const WATCH: Record<
    string,
    { kind: string; title: string; severity: string; params: Record<string, unknown> }[]
  > = {
    "anna@example.com": [
      {
        kind: "message_keyword",
        title: "Риск самоповреждения в переписке",
        severity: "critical",
        params: { terms: ["не хочу жить", "нет смысла", "не хочу больше"] },
      },
      {
        kind: "missed_doses",
        title: "Пропуски приёма два дня подряд",
        severity: "high",
        params: { days: 2 },
      },
    ],
    "mikhail@example.com": [
      {
        kind: "diary_below",
        title: "Самочувствие на тройку или ниже",
        severity: "medium",
        params: { threshold: 3 },
      },
    ],
  };

  const PLAN: Record<string, { title: string }> = {
    "anna@example.com": { title: "Сертралин 50 мг" },
    "mikhail@example.com": { title: "Сертралин 25 мг" },
  };

  const PLAN_DRAFT: Record<string, string> = {
    "anna@example.com": "КПТ: 8 сессий",
    "mikhail@example.com": "Дневник тревоги дважды в день",
  };

  // 6 дней от назначения: три приёма, один пропуск с причиной, один день без ответа.
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
      log(`добавлена история PHQ-9 для ${demo.email}`);
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
      log(`добавлена история дневника для ${demo.email}`);
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

      // Выполнено, пропуск и день без ответа: все три состояния в демо.
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

      log(`добавлены назначения и история приёма для ${demo.email}`);
    }

    const [hasWatch] = await db
      .select({ id: watchItems.id })
      .from(watchItems)
      .where(eq(watchItems.patientId, patient.id))
      .limit(1);

    if (!hasWatch) {
      const rules = WATCH[demo.email] ?? [];
      for (const rule of rules) {
        await db.insert(watchItems).values({
          id: randomUUID(),
          patientId: patient.id,
          doctorId: doctor.id,
          kind: rule.kind,
          title: rule.title,
          severity: rule.severity,
          params: JSON.stringify(rule.params),
          status: "active",
          createdAt: daysAgo(7),
        });
      }
      if (rules.length > 0) log(`добавлены правила наблюдения для ${demo.email}`);
    }
  }
}
