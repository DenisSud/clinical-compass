import type { FastifyPluginAsync } from "fastify";
import { healthResponse } from "../../shared/contracts.js";

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/health", async () => {
    app.conn.sqlite.prepare("SELECT 1").get();
    return healthResponse.parse({ status: "ok", db: "ok", time: new Date().toISOString() });
  });
};
