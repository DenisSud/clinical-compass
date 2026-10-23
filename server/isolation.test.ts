import { describe, expect, it } from "vitest";
import { DOCTOR, PATIENT, newApp, signUpDoctor, signUpPatient } from "./test-support.js";

type App = Awaited<ReturnType<typeof newApp>>;

async function bindPatient(app: App, doctorCookie: string, patientCookie: string): Promise<void> {
  const { code } = await app.inject({
    method: "GET",
    url: "/api/link-code",
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

describe("doctor unbinding a patient", () => {
  it("removes the patient from the list and clears the patient's doctor", async () => {
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

  it("keeps the patient's account, so they can bind again", async () => {
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

describe("cross-role and cross-doctor access", () => {
  it("stops a doctor from opening another doctor's patient", async () => {
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

  it("stops a doctor from unbinding another doctor's patient", async () => {
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

  it("stops a patient from reading or unbinding through the doctor's routes", async () => {
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

  it("does not let one patient read another patient's card", async () => {
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

  it("reports an unknown patient as not found", async () => {
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

  it("takes identity from the session only, never from the request body", async () => {
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
