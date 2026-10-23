import type { FastifyReply, FastifyRequest } from "fastify";
import { forbidden, unauthorized } from "../http/errors.js";
import { readSession, type Auth, type Role } from "./session.js";

/** Rejects anonymous callers, and callers holding a session for the other role. */
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

/** Reads what requireRole() stored. Throws when a handler is mounted without the guard. */
export function requireAuth(request: FastifyRequest): Auth {
  if (!request.auth) throw new Error("requireRole() must run before this handler");
  return request.auth;
}
