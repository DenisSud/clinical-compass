import type { FastifyPluginAsync } from "fastify";
import { LOGIN_PATH } from "../../shared/login-routes.js";

/**
 * The address that existed before #55 keeps working even without the SPA fallback:
 * an old link to `/login` is sent to the patient screen instead of the app root.
 */
export const loginRoutes: FastifyPluginAsync = async (app) => {
  app.get("/login", async (_request, reply) => reply.redirect(LOGIN_PATH.patient, 302));
};
