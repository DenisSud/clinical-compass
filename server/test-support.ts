import type { LightMyRequestResponse } from "fastify";
import { expect } from "vitest";
import { buildApp } from "./app.js";

export type App = Awaited<ReturnType<typeof buildApp>>;

export const DOCTOR = {
  email: "doctor@example.com",
  password: "correct horse battery",
  specialty: "therapist" as const,
};
export const PATIENT = { email: "patient@example.com", password: "another good password" };

/** Специальность — поле врача (SPEC S2): от неё зависит этап его пациентов, а не от теста. */
/** Специальность называет сам тест; умолчание — терапевт, как в старых сценариях. */
export type DoctorAccount = { email: string; password: string; specialty?: "therapist" | "psychiatrist" };

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
 * Привязка пациента к врачу — тот же маршрут, что у пациента в карточке. Этап пациент
 * получает вместе с врачом: у терапевта скрининг, у психиатра терапия (SPEC S3, Q49),
 * поэтому переключателя этапа в тестах нет.
 */
export async function bindPatient(
  app: App,
  patientCookie: string,
  doctorCookie: string,
): Promise<void> {
  const code = await app.inject({
    method: "GET",
    url: "/api/binding-code",
    headers: { cookie: doctorCookie },
  });
  const response = await app.inject({
    method: "POST",
    url: "/api/bind",
    headers: { cookie: patientCookie },
    payload: { code: code.json().code },
  });
  if (response.statusCode !== 200) {
    throw new Error(`привязка не состоялась: ${response.statusCode}`);
  }
}

export async function signUpDoctor(app: App, credentials: DoctorAccount = DOCTOR): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/doctor/signup",
    payload: { specialty: "therapist", ...credentials },
  });
  expect(response.statusCode).toBe(201);
  return cookieOf(response);
}
