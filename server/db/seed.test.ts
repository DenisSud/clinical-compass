import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { doctorInstruments, patientInstruments } from "../instruments/loader.js";
import { createDb } from "./client.js";
import { assessments, doctors, patients } from "./schema.js";
import { DEMO_PATIENTS, SEED_DOCTOR_EMAIL, seedDemo } from "./seed-demo.js";

/** Свежая база с миграциями: демо проверяется на том, что видит первый запуск. */
function freshDb() {
  return createDb(":memory:");
}

describe("демо-засев", () => {
  it("засеивает психиатра, а не терапевта", async () => {
    const conn = freshDb();
    await seedDemo(conn.db, () => {});

    const [doctor] = await conn.db.select().from(doctors).where(eq(doctors.email, SEED_DOCTOR_EMAIL));
    expect(doctor?.specialty).toBe("psychiatrist");
    conn.sqlite.close();
  });

  it("привязывает пациентов и ставит их на этап терапии", async () => {
    const conn = freshDb();
    await seedDemo(conn.db, () => {});

    const [doctor] = await conn.db.select().from(doctors).where(eq(doctors.email, SEED_DOCTOR_EMAIL));
    const rows = await conn.db.select().from(patients);

    expect(rows).toHaveLength(DEMO_PATIENTS.length);
    for (const patient of rows) {
      expect(patient.doctorId).toBe(doctor?.id);
      expect(patient.boundAt).not.toBeNull();
      // Этап выводится из специальности врача (SPEC S3, Q49), поэтому он и есть терапия.
      expect(patient.status).toBe("treatment");
    }
    conn.sqlite.close();
  });

  it("делает врачебную часть демо достижимой: HDRS-17, HADS и UKU", async () => {
    const conn = freshDb();
    await seedDemo(conn.db, () => {});

    const rowIds = (items: { id: string }[]) => items.map((item) => item.id);

    // Этап терапии даёт пациенту HADS и UKU, а врачу — шкалу после приёма.
    expect(rowIds(patientInstruments("treatment"))).toEqual(
      expect.arrayContaining(["hads-anxiety", "hads-depression", "uku"]),
    );
    expect(rowIds(doctorInstruments())).toContain("hdrs-17");
    conn.sqlite.close();
  });

  it("наполняет историю, а не оставляет пустые таблицы", async () => {
    const conn = freshDb();
    await seedDemo(conn.db, () => {});

    const rows = await conn.db.select().from(assessments);
    expect(rows.length).toBeGreaterThan(0);
    conn.sqlite.close();
  });

  it("доводит старый засев до терапии, а не оставляет терапевта", async () => {
    const conn = freshDb();
    const { randomUUID } = await import("node:crypto");
    await conn.db.insert(doctors).values({
      id: randomUUID(),
      email: SEED_DOCTOR_EMAIL,
      passwordHash: "x",
      specialty: "therapist",
      createdAt: new Date().toISOString(),
    });
    await conn.db.insert(patients).values({
      id: randomUUID(),
      email: DEMO_PATIENTS[0]!.email,
      passwordHash: "x",
      doctorId: null,
      createdAt: new Date().toISOString(),
    });

    await seedDemo(conn.db, () => {});

    const [doctor] = await conn.db.select().from(doctors).where(eq(doctors.email, SEED_DOCTOR_EMAIL));
    const [patient] = await conn.db.select().from(patients).where(eq(patients.email, DEMO_PATIENTS[0]!.email));
    expect(doctor?.specialty).toBe("psychiatrist");
    expect(patient?.status).toBe("treatment");
    expect(patient?.doctorId).toBe(doctor?.id);
    conn.sqlite.close();
  });
});
