import { eq } from "drizzle-orm";
import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { randomInt } from "node:crypto";
import type { BindingCodeResponse } from "../../shared/contracts.js";
import { requireAuth, requireRole } from "../auth/guard.js";
import { doctors } from "../db/schema.js";
import { unauthorized } from "../http/errors.js";

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

async function issueCode(app: FastifyInstance, doctorId: string): Promise<BindingCodeResponse> {
  const code = generateCode();
  const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString();

  await app.conn.db
    .update(doctors)
    .set({ bindingCode: code, bindingCodeExpiresAt: expiresAt })
    .where(eq(doctors.id, doctorId));

  return { code, expiresAt };
}

export const bindingCodeRoutes: FastifyPluginAsync = async (app) => {
  app.get("/binding-code", { preHandler: requireRole("doctor") }, async (request, reply) => {
    const doctorId = requireAuth(request).userId;
    const [doctor] = await app.conn.db.select().from(doctors).where(eq(doctors.id, doctorId)).limit(1);
    if (!doctor) return unauthorized(reply);

    if (
      doctor.bindingCode !== null &&
      doctor.bindingCodeExpiresAt !== null &&
      new Date(doctor.bindingCodeExpiresAt).getTime() > Date.now()
    ) {
      return { code: doctor.bindingCode, expiresAt: doctor.bindingCodeExpiresAt } satisfies BindingCodeResponse;
    }

    return issueCode(app, doctorId);
  });

  app.post("/binding-code/rotate", { preHandler: requireRole("doctor") }, async (request) => {
    return issueCode(app, requireAuth(request).userId);
  });
};
