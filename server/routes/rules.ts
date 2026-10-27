import type { FastifyPluginAsync } from "fastify";
import type { RulesResponse } from "../../shared/rules.js";
import { requireRole } from "../auth/guard.js";
import { listRules } from "../rules/registry.js";

/** Только чтение: врач видит каждое правило и его источник и ничего не правит. */
export const rulesRoutes: FastifyPluginAsync = async (app) => {
  app.get("/rules", { preHandler: requireRole("doctor") }, async (): Promise<RulesResponse> => {
    return { rules: listRules() };
  });
};
