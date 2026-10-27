import Database from "better-sqlite3";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationsDir = fileURLToPath(new URL("./migrations", import.meta.url));

/** Миграция, которая делает СКФ дробной (#52). Файлы до неё — состояние «как было». */
const EGFR_MIGRATION = "0013_egfr_fractional.sql";

const files = readdirSync(migrationsDir)
  .filter((file) => file.endsWith(".sql"))
  .sort();

function apply(sqlite: Database.Database, file: string): void {
  sqlite.exec(readFileSync(join(migrationsDir, file), "utf8"));
}

function egfrOf(sqlite: Database.Database): unknown {
  return (
    sqlite.prepare("SELECT egfr_ml_min AS egfr FROM patient_facts WHERE patient_id = 'p1'").get() as {
      egfr: unknown;
    }
  ).egfr;
}

describe("миграция 0015: этап пациента и специальность врача", () => {
  const MIGRATION = "0015_stage_and_specialty.sql";

  it("файл на месте и идёт после дробной СКФ", () => {
    // Последней теперь стала миграция приёмов, поэтому здесь проверяется место 0015 среди
    // уже накопленных: файл не переименован и порядок не нарушен.
    expect(files.indexOf(MIGRATION)).toBeGreaterThan(files.indexOf(EGFR_MIGRATION));
  });

  it("даёт существующему пациенту скрининг, а врачу — терапию по умолчанию", () => {
    const sqlite = new Database(":memory:");
    for (const file of files) {
      if (file === MIGRATION) continue;
      apply(sqlite, file);
    }
    sqlite
      .prepare("INSERT INTO doctors (id, email, password_hash, created_at) VALUES ('d1', 'd@b.c', 'x', '2026-10-27')")
      .run();
    sqlite
      .prepare("INSERT INTO patients (id, email, password_hash, created_at) VALUES ('p1', 'a@b.c', 'x', '2026-10-27')")
      .run();

    apply(sqlite, MIGRATION);

    const status = sqlite.prepare("SELECT status FROM patients WHERE id = 'p1'").get() as { status: string };
    const specialty = sqlite.prepare("SELECT specialty FROM doctors WHERE id = 'd1'").get() as {
      specialty: string;
    };
    // Умолчание — скрининг и терапевт: это точка входа, психиатра выбирают явно (Q49).
    expect(status.status).toBe("screening");
    expect(specialty.specialty).toBe("therapist");

    // Третьего этапа и третьей специальности не существует (Q49, S2): база это тоже знает.
    expect(() =>
      sqlite.prepare("UPDATE patients SET status = 'worsening' WHERE id = 'p1'").run(),
    ).toThrow(/CHECK/);
    expect(() =>
      sqlite.prepare("UPDATE doctors SET specialty = 'surgeon' WHERE id = 'd1'").run(),
    ).toThrow(/CHECK/);
    sqlite.close();
  });
});

describe("миграция 0013: СКФ перестаёт быть целой", () => {
  it("файл на месте", () => {
    expect(files).toContain(EGFR_MIGRATION);
  });

  it("сохраняет старые значения и принимает 59.6", () => {
    const sqlite = new Database(":memory:");
    for (const file of files.filter((candidate) => candidate < EGFR_MIGRATION)) apply(sqlite, file);

    sqlite
      .prepare(
        "INSERT INTO patients (id, email, password_hash, created_at) VALUES ('p1', 'p1@example.com', 'hash', '2026-01-01T00:00:00Z')",
      )
      .run();
    sqlite
      .prepare(
        "INSERT INTO patient_facts (patient_id, egfr_ml_min, child_pugh, updated_at) VALUES ('p1', 45, 'B', '2026-01-02T00:00:00Z')",
      )
      .run();

    apply(sqlite, EGFR_MIGRATION);

    // Записанное до миграции целое остаётся тем же числом, а не теряется вместе с типом.
    expect(egfrOf(sqlite)).toBe(45);
    const rest = sqlite
      .prepare("SELECT child_pugh AS pugh FROM patient_facts WHERE patient_id = 'p1'")
      .get() as { pugh: string };
    expect(rest.pugh).toBe("B");

    sqlite.prepare("UPDATE patient_facts SET egfr_ml_min = 59.6 WHERE patient_id = 'p1'").run();
    expect(egfrOf(sqlite)).toBe(59.6);

    // Диапазон остался проверкой: REAL не значит «что угодно».
    expect(() =>
      sqlite.prepare("UPDATE patient_facts SET egfr_ml_min = 250 WHERE patient_id = 'p1'").run(),
    ).toThrow();
    sqlite.close();
  });
});

describe("миграция 0016: приёмы и напоминание на почту", () => {
  const MIGRATION = "0016_appointments.sql";

  it("файл на месте и идёт последним", () => {
    expect(files.at(-1)).toBe(MIGRATION);
  });

  it("сохраняет историю приёмов и не включает почту без согласия пациента", () => {
    const sqlite = new Database(":memory:");
    for (const file of files) {
      if (file === MIGRATION) continue;
      apply(sqlite, file);
    }
    sqlite
      .prepare("INSERT INTO doctors (id, email, password_hash, created_at) VALUES ('d1', 'd@b.c', 'x', '2026-10-27')")
      .run();
    sqlite
      .prepare("INSERT INTO patients (id, email, password_hash, created_at) VALUES ('p1', 'a@b.c', 'x', '2026-10-27')")
      .run();

    apply(sqlite, MIGRATION);

    // Согласие по умолчанию не дано: напоминание на почту — выбор пациента (S24, Q49).
    const remind = sqlite.prepare("SELECT remind_by_email AS value FROM patients WHERE id = 'p1'").get() as {
      value: number;
    };
    expect(remind.value).toBe(0);

    sqlite
      .prepare(
        "INSERT INTO appointments (id, patient_id, doctor_id, scheduled_at, created_at) VALUES ('a1', 'p1', 'd1', '2026-11-03T14:00:00.000Z', '2026-10-27T09:00:00.000Z')",
      )
      .run();
    // Отмена — дата, а не удаление строки: приём остаётся в истории.
    sqlite.prepare("UPDATE appointments SET cancelled_at = '2026-10-27T10:00:00.000Z' WHERE id = 'a1'").run();
    const rows = sqlite.prepare("SELECT id FROM appointments WHERE patient_id = 'p1'").all();
    expect(rows).toHaveLength(1);

    expect(() =>
      sqlite.prepare("UPDATE patients SET remind_by_email = 2 WHERE id = 'p1'").run(),
    ).toThrow(/CHECK/);
    sqlite.close();
  });
});
