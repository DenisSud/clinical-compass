import fastifyCookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDb } from "./db/client.js";
import { authRoutes } from "./routes/auth.js";
import { assessmentRoutes } from "./routes/assessments.js";
import { diaryRoutes } from "./routes/diary.js";
import { messageRoutes } from "./routes/messages.js";
import { planRoutes } from "./routes/plan.js";
import { checkinRoutes } from "./routes/checkins.js";
import { recommendationRoutes } from "./routes/recommendations.js";
import { signalRoutes } from "./routes/signals.js";
import { bindRoutes } from "./routes/bind.js";
import { healthRoutes } from "./routes/health.js";
import { bindingCodeRoutes } from "./routes/binding-code.js";
import { meRoutes } from "./routes/me.js";
import { patientRoutes } from "./routes/patients.js";

const here = dirname(fileURLToPath(import.meta.url));

export type BuildAppOptions = {
  dbPath?: string;
  serveStatic?: boolean;
  logger?: boolean;
};

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? process.env.NODE_ENV !== "test" });

  app.decorate("conn", createDb(options.dbPath ?? process.env.SQLITE_DB ?? "var/app.db"));
  await app.register(fastifyCookie);
  await app.register(healthRoutes, { prefix: "/api" });
  await app.register(authRoutes, { prefix: "/api" });
  await app.register(meRoutes, { prefix: "/api" });
  await app.register(patientRoutes, { prefix: "/api" });
  await app.register(bindingCodeRoutes, { prefix: "/api" });
  await app.register(bindRoutes, { prefix: "/api" });
  await app.register(assessmentRoutes, { prefix: "/api" });
  await app.register(diaryRoutes, { prefix: "/api" });
  await app.register(signalRoutes, { prefix: "/api" });
  await app.register(planRoutes, { prefix: "/api" });
  await app.register(messageRoutes, { prefix: "/api" });
  await app.register(recommendationRoutes, { prefix: "/api" });
  await app.register(checkinRoutes, { prefix: "/api" });

  if (options.serveStatic) {
    await app.register(fastifyStatic, { root: join(here, "public") });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api")) {
        return reply.code(404).send({ code: "not_found", message: "Маршрут не найден" });
      }
      return reply.sendFile("index.html");
    });
  }

  app.addHook("onClose", async () => {
    app.conn.sqlite.close();
  });

  return app;
}
