import { eq } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireAuth, requireRole } from "../auth/guard.js";
import { doctors, patients } from "../db/schema.js";
import { statusForSpecialty } from "../instruments/statuses.js";
import { fail } from "../http/errors.js";

const bindRequestSchema = z.object({ code: z.string().trim().min(1).max(20) });

export const bindRoutes: FastifyPluginAsync = async (app) => {
  app.post("/bind", { preHandler: requireRole("patient") }, async (request, reply) => {
    const parsed = bindRequestSchema.safeParse(request.body);
    if (!parsed.success) return fail(reply, 400, "invalid_code", "Введите код привязки");

    const code = parsed.data.code.toUpperCase();
    const [doctor] = await app.conn.db.select().from(doctors).where(eq(doctors.bindingCode, code)).limit(1);

    if (!doctor) return fail(reply, 404, "invalid_code", "Код не найден. Проверьте написание");
    if (!doctor.bindingCodeExpiresAt || new Date(doctor.bindingCodeExpiresAt).getTime() <= Date.now()) {
      return fail(
        reply,
        410,
        "code_expired",
        "Срок действия кода истёк. Попросите врача выдать новый",
      );
    }

    const boundAt = new Date().toISOString();
    // Этап пациента следует из специальности врача, а не из отдельной кнопки (Q49):
    // у психиатра пациент сразу в терапии, у терапевта в скрининге.
    const status = statusForSpecialty(doctor.specialty);
    await app.conn.db
      .update(patients)
      .set({ doctorId: doctor.id, boundAt, status })
      .where(eq(patients.id, requireAuth(request).userId));

    return { doctorId: doctor.id, boundAt };
  });
};
