import { eq } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireRole } from "../auth/guard.js";
import { doctors, patients } from "../db/schema.js";

const bindRequest = z.object({ code: z.string().trim().min(1).max(20) });

export const bindRoutes: FastifyPluginAsync = async (app) => {
  app.post("/bind", { preHandler: requireRole("patient") }, async (request, reply) => {
    const parsed = bindRequest.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "invalid_code", message: "Введите код привязки" });
    }

    const code = parsed.data.code.toUpperCase();
    const [doctor] = await app.conn.db.select().from(doctors).where(eq(doctors.linkCode, code)).limit(1);

    if (!doctor) {
      return reply.code(404).send({ code: "invalid_code", message: "Код не найден. Проверьте написание" });
    }
    if (!doctor.linkCodeExpiresAt || new Date(doctor.linkCodeExpiresAt).getTime() <= Date.now()) {
      return reply.code(410).send({ code: "code_expired", message: "Срок действия кода истёк. Попросите врача выдать новый" });
    }

    const boundAt = new Date().toISOString();
    await app.conn.db
      .update(patients)
      .set({ doctorId: doctor.id, boundAt })
      .where(eq(patients.id, request.auth!.userId));

    return { doctorId: doctor.id, boundAt };
  });
};
