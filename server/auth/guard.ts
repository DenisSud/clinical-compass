import type { FastifyReply, FastifyRequest } from "fastify";
import { readSession, type Role } from "./session.js";

/** Rejects anonymous callers, and callers holding a session for the other role. */
export function requireRole(role: Role) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const auth = await readSession(request.server.conn, request);

    if (!auth) {
      await reply.code(401).send({ code: "unauthorized", message: "Нужно войти в аккаунт" });
      return;
    }
    if (auth.role !== role) {
      await reply.code(403).send({ code: "forbidden", message: "Недостаточно прав" });
      return;
    }

    request.auth = auth;
  };
}
