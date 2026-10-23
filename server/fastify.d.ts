import type { Db } from "./db/client.js";
import type { Auth } from "./auth/session.js";

declare module "fastify" {
  interface FastifyInstance {
    conn: Db;
  }
  interface FastifyRequest {
    auth?: Auth;
  }
}
