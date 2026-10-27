import { eq } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import { doctors } from "../db/schema.js";
import { forbidden, unauthorized } from "../http/errors.js";
import { readSession, type Auth, type Role } from "./session.js";

/**
 * Отказ терапевту один и тот же: он не назначает препараты, не меняет план, не
 * назначает приём и не заполняет шкалы врача (SPEC S7, S14, S24, Q50, Q53).
 */
const PSYCHIATRIST_ONLY = "Это действие доступно только психиатру";

/** Отклоняет анонимные запросы и запросы с сессией другой роли. */
export function requireRole(role: Role) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const auth = await readSession(request.server.conn, request, reply);

    if (!auth) {
      unauthorized(reply);
      return;
    }
    if (auth.role !== role) {
      forbidden(reply);
      return;
    }

    request.auth = auth;
  };
}

/** Читает то, что сохранил requireRole(). Бросает, когда обработчик смонтирован без проверки. */
export function requireAuth(request: FastifyRequest): Auth {
  if (!request.auth) throw new Error("requireRole() must run before this handler");
  return request.auth;
}

/**
 * Лечение ведёт психиатр: терапевт препараты не назначает и план не редактирует
 * (SPEC S7, decisions.md Q50). Специальность — поле врача, а не роль (S2), поэтому
 * проверка отдельная от requireRole и ставится после неё.
 *
 * Чтение не закрывается: план психиатра терапевт видит, если пациент ещё за ним.
 */
export function requirePsychiatrist() {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const auth = requireAuth(request);
    const [doctor] = await request.server.conn.db
      .select({ specialty: doctors.specialty })
      .from(doctors)
      .where(eq(doctors.id, auth.userId))
      .limit(1);

    if (doctor?.specialty !== "psychiatrist") forbidden(reply, PSYCHIATRIST_ONLY);
  };
}
