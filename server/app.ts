import fastifyCookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDb } from "./db/client.js";
import { authRoutes } from "./routes/auth.js";
import { healthRoutes } from "./routes/health.js";
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
