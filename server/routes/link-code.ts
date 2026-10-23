import { eq } from "drizzle-orm";
import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { randomInt } from "node:crypto";
import type { LinkCodeResponse } from "../../shared/contracts.js";
import { requireRole } from "../auth/guard.js";
import { doctors } from "../db/schema.js";

/** No 0/O/1/I: the code is read aloud and written down by hand. */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;
const CODE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function generateCode(): string {
  let code = "";
  for (let index = 0; index < CODE_LENGTH; index += 1) {
    code += ALPHABET[randomInt(ALPHABET.length)];
  }
  return code;
}

async function issueCode(app: FastifyInstance, doctorId: string): Promise<LinkCodeResponse> {
  const code = generateCode();
  const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString();

  await app.conn.db.update(doctors).set({ linkCode: code, linkCodeExpiresAt: expiresAt }).where(eq(doctors.id, doctorId));

  return { code, expiresAt };
}

export const linkCodeRoutes: FastifyPluginAsync = async (app) => {
  app.get("/link-code", { preHandler: requireRole("doctor") }, async (request, reply) => {
    const doctorId = request.auth!.userId;
    const [doctor] = await app.conn.db.select().from(doctors).where(eq(doctors.id, doctorId)).limit(1);
    if (!doctor) {
      return reply.code(401).send({ code: "unauthorized", message: "Нужно войти в аккаунт" });
    }

    if (
      doctor.linkCode !== null &&
      doctor.linkCodeExpiresAt !== null &&
      new Date(doctor.linkCodeExpiresAt).getTime() > Date.now()
    ) {
      return { code: doctor.linkCode, expiresAt: doctor.linkCodeExpiresAt } satisfies LinkCodeResponse;
    }

    return issueCode(app, doctorId);
  });

  app.post("/link-code/rotate", { preHandler: requireRole("doctor") }, async (request) => {
    return issueCode(app, request.auth!.userId);
  });
};
