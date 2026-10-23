import type { FastifyReply } from "fastify";
import { apiErrorSchema } from "../../shared/contracts.js";

/** Sends the one error shape every route uses. */
export function fail(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.code(status).send(apiErrorSchema.parse({ code, message }));
}

export const unauthorized = (reply: FastifyReply) =>
  fail(reply, 401, "unauthorized", "Нужно войти в аккаунт");

export const forbidden = (reply: FastifyReply, message = "Недостаточно прав") =>
  fail(reply, 403, "forbidden", message);

export const notFound = (reply: FastifyReply, message: string) =>
  fail(reply, 404, "not_found", message);
