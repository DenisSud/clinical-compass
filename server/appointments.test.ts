import { describe, expect, it } from "vitest";
import { nextAppointment } from "../shared/appointments.js";
import type { Appointment } from "../shared/contracts.js";
import { bindPatient, newApp, signUpDoctor, signUpPatient, type App } from "./test-support.js";

const PSYCHIATRIST = {
  email: "psychiatrist@example.com",
  password: "correct horse battery",
  specialty: "psychiatrist" as const,
};

const THERAPIST = {
  email: "therapist@example.com",
  password: "correct horse battery",
  specialty: "therapist" as const,
};

/** Время в будущем: приём назначают вперёд, и тест не зависит от текущей даты. */
function inHours(hours: number): string {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

async function boundPair(
  app: App,
  doctor: typeof PSYCHIATRIST | typeof THERAPIST = PSYCHIATRIST,
) {
  const doctorCookie = await signUpDoctor(app, doctor);
  const patientCookie = await signUpPatient(app);
  await bindPatient(app, patientCookie, doctorCookie);

  const me = await app.inject({ method: "GET", url: "/api/me", headers: { cookie: patientCookie } });
  return { doctorCookie, patientCookie, patientId: me.json().profile.id as string };
}

function create(app: App, cookie: string, patientId: string, scheduledAt: string, body?: unknown) {
  return app.inject({
    method: "POST",
    url: `/api/patients/${patientId}/appointments`,
    headers: { cookie },
    payload: (body ?? { scheduledAt }) as Record<string, unknown>,
  });
}

function list(app: App, cookie: string, patientId: string) {
  return app.inject({
    method: "GET",
    url: `/api/patients/${patientId}/appointments`,
    headers: { cookie },
  });
}

describe("назначение приёма", () => {
  it("психиатр назначает приём, и пациент видит его в своих записях", async () => {
    const app = await newApp();
    const { doctorCookie, patientCookie, patientId } = await boundPair(app);
    const scheduledAt = inHours(50);

    const created = await create(app, doctorCookie, patientId, scheduledAt);
    expect(created.statusCode).toBe(201);
    expect(created.json().appointment.scheduledAt).toBe(scheduledAt);

    const mine = await list(app, patientCookie, patientId);
    expect(mine.statusCode).toBe(200);
    expect(mine.json().appointments).toHaveLength(1);
    await app.close();
  });

  it("новый приём отменяет прошлый будущий, а историю оставляет", async () => {
    const app = await newApp();
    const { doctorCookie, patientId } = await boundPair(app);

    const first = await create(app, doctorCookie, patientId, inHours(48));
    const second = await create(app, doctorCookie, patientId, inHours(72));

    expect(second.statusCode).toBe(201);
    const appointments = (await list(app, doctorCookie, patientId)).json()
      .appointments as Appointment[];

    // Две строки, а не одна: перенос — это отмена прошлого приёма, а не его удаление.
    expect(appointments).toHaveLength(2);
    const cancelled = appointments.find((row) => row.id === first.json().appointment.id);
    expect(cancelled?.cancelledAt).not.toBeNull();
    expect(nextAppointment(appointments, new Date())?.id).toBe(second.json().appointment.id);
    await app.close();
  });

  it("не назначает приём на прошедшее время", async () => {
    const app = await newApp();
    const { doctorCookie, patientId } = await boundPair(app);

    const response = await create(app, doctorCookie, patientId, inHours(-2));

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("appointment_in_past");
    await app.close();
  });

  it("не принимает время без зоны", async () => {
    const app = await newApp();
    const { doctorCookie, patientId } = await boundPair(app);

    const response = await create(app, doctorCookie, patientId, "2026-11-03T14:00", {
      scheduledAt: "2026-11-03T14:00",
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it("терапевт приём не назначает, но читает записи своего пациента", async () => {
    const app = await newApp();
    const { doctorCookie, patientId } = await boundPair(app, THERAPIST);

    const created = await create(app, doctorCookie, patientId, inHours(48));
    expect(created.statusCode).toBe(403);

    const read = await list(app, doctorCookie, patientId);
    expect(read.statusCode).toBe(200);
    await app.close();
  });

  it("чужой врач и чужой пациент приёмов не видят", async () => {
    const app = await newApp();
    const { patientId } = await boundPair(app);
    const stranger = await signUpDoctor(app, { email: "other@example.com", password: "other password" });
    const otherPatient = await signUpPatient(app, {
      email: "other-patient@example.com",
      password: "another good password",
    });

    expect((await list(app, stranger, patientId)).statusCode).toBe(403);
    expect((await list(app, otherPatient, patientId)).statusCode).toBe(403);
    await app.close();
  });

  it("без входа записи не отдаются", async () => {
    const app = await newApp();
    const { patientId } = await boundPair(app);

    const response = await app.inject({ method: "GET", url: `/api/patients/${patientId}/appointments` });
    expect(response.statusCode).toBe(401);
    await app.close();
  });
});

describe("отмена приёма", () => {
  it("отменяет будущий приём и второй раз не отменяет", async () => {
    const app = await newApp();
    const { doctorCookie, patientId } = await boundPair(app);
    const created = await create(app, doctorCookie, patientId, inHours(48));
    const appointmentId = created.json().appointment.id as string;

    const cancelled = await app.inject({
      method: "DELETE",
      url: `/api/patients/${patientId}/appointments/${appointmentId}`,
      headers: { cookie: doctorCookie },
    });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().appointment.cancelledAt).not.toBeNull();

    const again = await app.inject({
      method: "DELETE",
      url: `/api/patients/${patientId}/appointments/${appointmentId}`,
      headers: { cookie: doctorCookie },
    });
    expect(again.statusCode).toBe(409);
    await app.close();
  });

  it("терапевт приём не отменяет", async () => {
    const app = await newApp();
    const { doctorCookie, patientId } = await boundPair(app, THERAPIST);

    const response = await app.inject({
      method: "DELETE",
      url: `/api/patients/${patientId}/appointments/any`,
      headers: { cookie: doctorCookie },
    });

    expect(response.statusCode).toBe(403);
    await app.close();
  });
});

describe("напоминание на почту", () => {
  it("выключено по умолчанию и включается пациентом", async () => {
    const app = await newApp();
    const { patientCookie } = await boundPair(app);

    const before = await app.inject({ method: "GET", url: "/api/me", headers: { cookie: patientCookie } });
    expect(before.json().profile.remindByEmail).toBe(false);

    const response = await app.inject({
      method: "PUT",
      url: "/api/appointment-reminder",
      headers: { cookie: patientCookie },
      payload: { remindByEmail: true },
    });
    expect(response.statusCode).toBe(200);

    const after = await app.inject({ method: "GET", url: "/api/me", headers: { cookie: patientCookie } });
    expect(after.json().profile.remindByEmail).toBe(true);
    await app.close();
  });

  it("врач настройку пациента не меняет", async () => {
    const app = await newApp();
    const { doctorCookie } = await boundPair(app);

    const response = await app.inject({
      method: "PUT",
      url: "/api/appointment-reminder",
      headers: { cookie: doctorCookie },
      payload: { remindByEmail: true },
    });

    expect(response.statusCode).toBe(403);
    await app.close();
  });
});
