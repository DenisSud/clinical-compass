import { describe, expect, it } from "vitest";
import { DOCTOR, PATIENT, newApp, signUpDoctor, signUpPatient } from "./test-support.js";

type App = Awaited<ReturnType<typeof newApp>>;

async function bindPatient(app: App, doctorCookie: string, patientCookie: string): Promise<void> {
  const { code } = await app.inject({
    method: "GET",
    url: "/api/binding-code",
    headers: { cookie: doctorCookie },
  }).then((response) => response.json<{ code: string }>());

  const bound = await app.inject({
    method: "POST",
    url: "/api/bind",
    headers: { cookie: patientCookie },
    payload: { code },
  });
  expect(bound.statusCode).toBe(200);
}

async function patientIdOf(app: App, patientCookie: string): Promise<string> {
  const me = await app.inject({ method: "GET", url: "/api/me", headers: { cookie: patientCookie } });
  return me.json<{ profile: { id: string } }>().profile.id;
}

describe("отвязка пациента врачом", () => {
  it("убирает пациента из списка и очищает у пациента врача", async () => {
    const app = await newApp();
    const doctorCookie = await signUpDoctor(app);
    const patientCookie = await signUpPatient(app);
    await bindPatient(app, doctorCookie, patientCookie);
    const patientId = await patientIdOf(app, patientCookie);

    const unbound = await app.inject({
      method: "POST",
      url: `/api/patients/${patientId}/unbind`,
      headers: { cookie: doctorCookie },
    });
    expect(unbound.statusCode).toBe(204);

    const list = await app.inject({ method: "GET", url: "/api/patients", headers: { cookie: doctorCookie } });
    expect(list.json()).toEqual({ patients: [] });

    const me = await app.inject({ method: "GET", url: "/api/me", headers: { cookie: patientCookie } });
    expect(me.json()).toMatchObject({ profile: { doctor: null, boundAt: null } });
    await app.close();
  });

  it("возвращает пациента на скрининг: без ведущего врача этапа терапии нет", async () => {
    const app = await newApp();
    const psychiatristCookie = await signUpDoctor(app, {
      email: "psychiatrist@example.com",
      password: "correct horse battery",
      specialty: "psychiatrist",
    });
    const patientCookie = await signUpPatient(app);
    await bindPatient(app, psychiatristCookie, patientCookie);
    const patientId = await patientIdOf(app, patientCookie);

    const before = await app.inject({ method: "GET", url: "/api/instruments", headers: { cookie: patientCookie } });
    expect(before.json().instruments.map((entry: { id: string }) => entry.id)).toContain("uku");

    await app.inject({
      method: "POST",
      url: `/api/patients/${patientId}/unbind`,
      headers: { cookie: psychiatristCookie },
    });

    const after = await app.inject({ method: "GET", url: "/api/instruments", headers: { cookie: patientCookie } });
    // Набор снова скрининговый: терапевтические шкалы никто не назначал (S3).
    expect(after.json().instruments.map((entry: { id: string }) => entry.id)).toEqual(["phq-9"]);
    await app.close();
  });

  it("сохраняет аккаунт пациента, чтобы он мог привязаться снова", async () => {
    const app = await newApp();
    const doctorCookie = await signUpDoctor(app);
    const patientCookie = await signUpPatient(app);
    await bindPatient(app, doctorCookie, patientCookie);
    const patientId = await patientIdOf(app, patientCookie);

    await app.inject({ method: "POST", url: `/api/patients/${patientId}/unbind`, headers: { cookie: doctorCookie } });
    await bindPatient(app, doctorCookie, patientCookie);

    const me = await app.inject({ method: "GET", url: "/api/me", headers: { cookie: patientCookie } });
    expect(me.json()).toMatchObject({ profile: { doctor: { email: DOCTOR.email } } });
    await app.close();
  });
});

describe("доступ между ролями и врачами", () => {
  it("не даёт врачу открыть пациента другого врача", async () => {
    const app = await newApp();
    const ownerCookie = await signUpDoctor(app);
    const strangerCookie = await signUpDoctor(app, {
      email: "stranger@example.com",
      password: "stranger password",
    });
    const patientCookie = await signUpPatient(app);
    await bindPatient(app, ownerCookie, patientCookie);
    const patientId = await patientIdOf(app, patientCookie);

    const response = await app.inject({
      method: "GET",
      url: `/api/patients/${patientId}`,
      headers: { cookie: strangerCookie },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: "forbidden" });
    await app.close();
  });

  it("не даёт врачу отвязать пациента другого врача", async () => {
    const app = await newApp();
    const ownerCookie = await signUpDoctor(app);
    const strangerCookie = await signUpDoctor(app, {
      email: "stranger@example.com",
      password: "stranger password",
    });
    const patientCookie = await signUpPatient(app);
    await bindPatient(app, ownerCookie, patientCookie);
    const patientId = await patientIdOf(app, patientCookie);

    const response = await app.inject({
      method: "POST",
      url: `/api/patients/${patientId}/unbind`,
      headers: { cookie: strangerCookie },
    });

    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it("не даёт пациенту читать или отвязываться через маршруты врача", async () => {
    const app = await newApp();
    const doctorCookie = await signUpDoctor(app);
    const patientCookie = await signUpPatient(app);
    await bindPatient(app, doctorCookie, patientCookie);
    const patientId = await patientIdOf(app, patientCookie);

    const read = await app.inject({
      method: "GET",
      url: `/api/patients/${patientId}`,
      headers: { cookie: patientCookie },
    });
    const unbind = await app.inject({
      method: "POST",
      url: `/api/patients/${patientId}/unbind`,
      headers: { cookie: patientCookie },
    });

    expect(read.statusCode).toBe(403);
    expect(unbind.statusCode).toBe(403);
    await app.close();
  });

  it("не даёт одному пациенту прочитать карточку другого", async () => {
    const app = await newApp();
    const doctorCookie = await signUpDoctor(app);
    const firstCookie = await signUpPatient(app);
    const secondCookie = await signUpPatient(app, {
      email: "second@example.com",
      password: "second good password",
    });
    await bindPatient(app, doctorCookie, firstCookie);
    await bindPatient(app, doctorCookie, secondCookie);
    const firstId = await patientIdOf(app, firstCookie);

    const response = await app.inject({
      method: "GET",
      url: `/api/patients/${firstId}`,
      headers: { cookie: secondCookie },
    });

    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it("сообщает о неизвестном пациенте как о ненайденном", async () => {
    const app = await newApp();
    const doctorCookie = await signUpDoctor(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/patients/00000000-0000-0000-0000-000000000000",
      headers: { cookie: doctorCookie },
    });

    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it("берёт личность только из сессии, никогда из тела запроса", async () => {
    const app = await newApp();
    const doctorCookie = await signUpDoctor(app);
    const patientCookie = await signUpPatient(app);
    await bindPatient(app, doctorCookie, patientCookie);
    const patientId = await patientIdOf(app, patientCookie);
    const doctorId = (
      await app.inject({ method: "GET", url: "/api/me", headers: { cookie: doctorCookie } })
    ).json<{ profile: { id: string } }>().profile.id;

    const spoofed = await app.inject({
      method: "POST",
      url: "/api/bind",
      headers: { cookie: patientCookie },
      payload: { code: "ZZZZZZ", patientId: "spoofed", doctorId, role: "doctor" },
    });

    expect(spoofed.statusCode).toBe(404);
    const me = await app.inject({ method: "GET", url: "/api/me", headers: { cookie: patientCookie } });
    expect(me.json()).toMatchObject({ role: "patient", profile: { id: patientId } });
    await app.close();
  });
});
