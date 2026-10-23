import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { hashPassword } from "../auth/password.js";
import { createDb } from "./client.js";
import { doctors, patients } from "./schema.js";

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

sqlite.close();
console.log(`\nвход для демо: ${DOCTOR_EMAIL} / ${PASSWORD}`);
console.log(`пациенты: ${DEMO_PATIENTS.map((p) => p.email).join(", ")} / ${PASSWORD}`);
