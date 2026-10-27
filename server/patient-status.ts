import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { patients } from "./db/schema.js";

/**
 * Этап пациента читает каждый пациентский маршрут, который отдаёт опросник: набор шкал —
 * свойство пациента, а не запроса (issue #68). Этап выведен из специальности ведущего
 * врача при привязке (SPEC S3), поэтому здесь он только читается. Пациент без строки —
 * ошибка данных, а не пустой набор, поэтому здесь исключение, а не `undefined`.
 */
export async function statusOf(app: FastifyInstance, patientId: string): Promise<string> {
  const [row] = await app.conn.db
    .select({ status: patients.status })
    .from(patients)
    .where(eq(patients.id, patientId))
    .limit(1);

  if (!row) throw new Error(`пациент ${patientId} не найден`);
  return row.status;
}
