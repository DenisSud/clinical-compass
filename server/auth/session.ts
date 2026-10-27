import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Db } from "../db/client.js";
import { sessions } from "../db/schema.js";

export const SESSION_COOKIE = "sid";
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SLIDE_THRESHOLD_MS = SESSION_TTL_MS - 24 * 60 * 60 * 1000;

export type Role = "doctor" | "patient";
export type Auth = { role: Role; userId: string };

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function setSessionCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    // Демо работает по http на localhost, где безопасная cookie не отправляется никогда.
    secure: process.env.NODE_ENV === "production",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: "/" });
}

export async function startSession(
  conn: Db,
  reply: FastifyReply,
  auth: Auth,
): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();

  await conn.db.insert(sessions).values({
    tokenHash: hashToken(token),
    role: auth.role,
    userId: auth.userId,
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
    createdAt: now.toISOString(),
  });

  setSessionCookie(reply, token);
}

/** Превращает cookie сессии в личность, продлевая и строку, и cookie, когда сессия старая. */
export async function readSession(
  conn: Db,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<Auth | null> {
  const token = request.cookies[SESSION_COOKIE];
  if (!token) return null;

  const tokenHash = hashToken(token);
  const [row] = await conn.db
    .select()
    .from(sessions)
    .where(eq(sessions.tokenHash, tokenHash))
    .limit(1);
  if (!row) return null;

  const expiresAt = new Date(row.expiresAt);
  const now = new Date();
  if (expiresAt.getTime() <= now.getTime()) {
    await conn.db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
    return null;
  }

  if (expiresAt.getTime() - now.getTime() < SLIDE_THRESHOLD_MS) {
    await conn.db
      .update(sessions)
      .set({ expiresAt: new Date(now.getTime() + SESSION_TTL_MS).toISOString() })
      .where(eq(sessions.tokenHash, tokenHash));
    setSessionCookie(reply, token);
  }

  return { role: row.role, userId: row.userId };
}

export async function endSession(conn: Db, request: FastifyRequest): Promise<void> {
  const token = request.cookies[SESSION_COOKIE];
  if (!token) return;
  await conn.db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}
