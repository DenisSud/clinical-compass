import type { Db } from "./db/client.js";

declare module "fastify" {
  interface FastifyInstance {
    conn: Db;
  }
}
