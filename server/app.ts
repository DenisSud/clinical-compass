import fastifyCookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDb } from "./db/client.js";
import { fail } from "./http/errors.js";
import { authRoutes } from "./routes/auth.js";
import { appointmentRoutes } from "./routes/appointments.js";
import { assessmentRoutes } from "./routes/assessments.js";
import { diaryRoutes } from "./routes/diary.js";
import { factsRoutes } from "./routes/facts.js";
import { messageRoutes } from "./routes/messages.js";
import { planRoutes } from "./routes/plan.js";
import { checkinRoutes } from "./routes/checkins.js";
import { prescriptionRoutes } from "./routes/prescriptions.js";
import { recommendationRoutes } from "./routes/recommendations.js";
import { signalRoutes } from "./routes/signals.js";
import { watchRoutes } from "./routes/watch.js";
import { rulesRoutes } from "./routes/rules.js";
import { bindRoutes } from "./routes/bind.js";
import { healthRoutes } from "./routes/health.js";
import { bindingCodeRoutes } from "./routes/binding-code.js";
import { loginRoutes } from "./routes/login.js";
import { meRoutes } from "./routes/me.js";
import { patientRoutes } from "./routes/patients.js";
import { assertStatusInstrumentsExist } from "./instruments/loader.js";

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

  // Файл статусов, называющий несуществующую шкалу, валит сборку, а не первый запрос
  // пациента: пустой список опросников выглядит как «врач ничего не назначил».
  assertStatusInstrumentsExist();

  // An empty body announced as JSON is not a server fault: a bodyless action
  // (pause a rule, take a signal) sends no body at all. Without this parser
  // Fastify rejects the request before routing and the doctor's click fails.
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (_request, body, done) => {
      const raw = typeof body === "string" ? body.trim() : "";
      if (raw === "") return done(null, {});
      try {
        done(null, JSON.parse(raw));
      } catch {
        done(
          Object.assign(new Error("Тело запроса не разобрано как JSON"), {
            statusCode: 400,
            code: "invalid_json",
          }),
          undefined,
        );
      }
    },
  );

  // Without this, a thrown error returns Fastify's own body, and a client that
  // validates against apiErrorSchema sees garbage exactly when something broke.
  // A refusal stays a refusal: turning a 400 into a 500 tells the doctor the
  // server broke when in fact the request did.
  app.setErrorHandler((error: { statusCode?: number; code?: string; message?: string }, request, reply) => {
    const status = error.statusCode ?? 500;
    if (status < 500) {
      request.log.info(error);
      return fail(reply, status, error.code ?? "bad_request", error.message ?? "Запрос отклонён");
    }
    request.log.error(error);
    return fail(reply, 500, "internal", "Внутренняя ошибка сервера");
  });

  await app.register(healthRoutes, { prefix: "/api" });
  await app.register(authRoutes, { prefix: "/api" });
  await app.register(meRoutes, { prefix: "/api" });
  await app.register(patientRoutes, { prefix: "/api" });
  await app.register(bindingCodeRoutes, { prefix: "/api" });
  await app.register(bindRoutes, { prefix: "/api" });
  await app.register(assessmentRoutes, { prefix: "/api" });
  await app.register(diaryRoutes, { prefix: "/api" });
  await app.register(factsRoutes, { prefix: "/api" });
  await app.register(signalRoutes, { prefix: "/api" });
  await app.register(planRoutes, { prefix: "/api" });
  await app.register(messageRoutes, { prefix: "/api" });
  await app.register(recommendationRoutes, { prefix: "/api" });
  await app.register(checkinRoutes, { prefix: "/api" });
  await app.register(prescriptionRoutes, { prefix: "/api" });
  await app.register(appointmentRoutes, { prefix: "/api" });
  await app.register(watchRoutes, { prefix: "/api" });
  await app.register(rulesRoutes, { prefix: "/api" });
  await app.register(loginRoutes);

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
