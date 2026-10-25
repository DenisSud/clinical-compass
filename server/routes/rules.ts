import type { FastifyPluginAsync } from "fastify";
import type { RulesResponse } from "../../shared/rules.js";
import { requireRole } from "../auth/guard.js";
import { listRules } from "../rules/registry.js";

/** Read-only: the doctor sees every rule and where it comes from, and edits nothing. */
export const rulesRoutes: FastifyPluginAsync = async (app) => {
  app.get("/rules", { preHandler: requireRole("doctor") }, async (): Promise<RulesResponse> => {
    return { rules: listRules() };
  });
};
