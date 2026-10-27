/**
 * Демо-данные для запуска: психиатр и двое его пациентов на этапе терапии.
 * Само состояние собирает `seed-demo.ts` — его же проверяет тест.
 */
import { createDb } from "./client.js";
import { DEMO_PATIENTS, SEED_DOCTOR_EMAIL, SEED_PASSWORD, seedDemo } from "./seed-demo.js";

const { sqlite, db } = createDb(process.env.SQLITE_DB ?? "var/app.db");

try {
  await seedDemo(db);
} finally {
  sqlite.close();
}

console.log(`\nвход для демо: ${SEED_DOCTOR_EMAIL} / ${SEED_PASSWORD} (психиатр)`);
console.log(`пациенты: ${DEMO_PATIENTS.map((patient) => patient.email).join(", ")} / ${SEED_PASSWORD}`);
