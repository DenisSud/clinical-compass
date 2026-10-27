import type { LightMyRequestResponse } from "fastify";
import { expect } from "vitest";
import { buildApp } from "./app.js";

export type App = Awaited<ReturnType<typeof buildApp>>;

export const DOCTOR = { email: "doctor@example.com", password: "correct horse battery" };
export const PATIENT = { email: "patient@example.com", password: "another good password" };

export function newApp(): Promise<App> {
  return buildApp({ dbPath: ":memory:", logger: false });
}

export function cookieOf(response: LightMyRequestResponse): string {
  const header = response.headers["set-cookie"];
  const raw = Array.isArray(header) ? header[0] : header;
  if (!raw) throw new Error("response carried no cookie");
  return raw.split(";")[0] ?? "";
}

export async function signUpPatient(
  app: App,
  credentials: { email: string; password: string } = PATIENT,
): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/patient/signup",
    payload: credentials,
  });
  expect(response.statusCode).toBe(201);
  return cookieOf(response);
}

/**
 * Врач ставит статус — так тесты выбирают набор опросников. Статус это пометка этапа,
 * а не вывод из данных, поэтому в тестах он ставится явно, а не выводится (Q47).
 */
export async function setPatientStatus(
  app: App,
  doctorCookie: string,
  patientId: string,
  status: "screening" | "treatment" | "worsening",
): Promise<void> {
  const response = await app.inject({
    method: "PATCH",
    url: `/api/patients/${patientId}/status`,
    headers: { cookie: doctorCookie },
    payload: { status },
  });
  if (response.statusCode !== 200) {
    throw new Error(`статус ${status} не поставился: ${response.statusCode}`);
  }
}

export async function signUpDoctor(
  app: App,
  credentials: { email: string; password: string } = DOCTOR,
): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/doctor/signup",
    payload: credentials,
  });
  expect(response.statusCode).toBe(201);
  return cookieOf(response);
}
