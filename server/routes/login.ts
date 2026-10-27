import type { FastifyPluginAsync } from "fastify";
import { LOGIN_PATH } from "../../shared/login-routes.js";

/**
 * Адрес, который был до #55, работает и без SPA-фолбэка: старая ссылка на `/login`
 * попадает на экран пациента вместо корня приложения.
 */
export const loginRoutes: FastifyPluginAsync = async (app) => {
  app.get("/login", async (_request, reply) => reply.redirect(LOGIN_PATH.patient, 302));
};
