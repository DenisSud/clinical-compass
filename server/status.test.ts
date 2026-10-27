import { describe, expect, it } from "vitest";
import { newApp, signUpDoctor, signUpPatient } from "./test-support.js";

async function boundPair() {
  const app = await newApp();
  const doctorCookie = await signUpDoctor(app);
  const patientCookie = await signUpPatient(app);

  const code = await app.inject({
    method: "GET",
    url: "/api/binding-code",
    headers: { cookie: doctorCookie },
  });
  await app.inject({
    method: "POST",
    url: "/api/bind",
    headers: { cookie: patientCookie },
    payload: { code: code.json().code },
  });

  const me = await app.inject({ method: "GET", url: "/api/me", headers: { cookie: patientCookie } });
  return { app, doctorCookie, patientCookie, patientId: me.json().profile.id as string };
}

function instrumentIds(body: { instruments: { id: string }[] }): string[] {
  return body.instruments.map((instrument) => instrument.id);
}

describe("the patient's questionnaire set", () => {
  it("is the status's set, in the file's order", async () => {
    const { app, patientCookie } = await boundPair();

    const response = await app.inject({
      method: "GET",
      url: "/api/instruments",
      headers: { cookie: patientCookie },
    });

    expect(response.statusCode).toBe(200);
    expect(instrumentIds(response.json())).toEqual(["phq-9", "asq"]);
    await app.close();
  });

  it("changes when the doctor moves the patient to treatment", async () => {
    const { app, doctorCookie, patientCookie, patientId } = await boundPair();

    await app.inject({
      method: "PATCH",
      url: `/api/patients/${patientId}/status`,
      headers: { cookie: doctorCookie },
      payload: { status: "treatment" },
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/instruments",
      headers: { cookie: patientCookie },
    });

    expect(instrumentIds(response.json())).toEqual(["gad-7", "phq-9", "asq"]);
    await app.close();
  });

  it("refuses an instrument the status does not assign, as if it did not exist", async () => {
    const { app, patientCookie } = await boundPair();

    const response = await app.inject({
      method: "GET",
      url: "/api/instruments/gad-7",
      headers: { cookie: patientCookie },
    });

    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it("refuses a submission of an instrument outside the status", async () => {
    const { app, patientCookie } = await boundPair();
    const answers = Object.fromEntries(Array.from({ length: 7 }, (_, index) => [`q${index + 1}`, 1]));

    const response = await app.inject({
      method: "POST",
      url: "/api/assessments/gad-7",
      headers: { cookie: patientCookie },
      payload: { submissionId: "outside", answers },
    });

    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it("never sends the status to the patient", async () => {
    const { app, patientCookie } = await boundPair();

    const me = await app.inject({ method: "GET", url: "/api/me", headers: { cookie: patientCookie } });
    const list = await app.inject({
      method: "GET",
      url: "/api/instruments",
      headers: { cookie: patientCookie },
    });

    expect(me.json().profile).not.toHaveProperty("status");
    expect(JSON.stringify(list.json())).not.toContain("screening");
    await app.close();
  });
});

describe("changing the status", () => {
  it("stores it and returns the doctor's view", async () => {
    const { app, doctorCookie, patientId } = await boundPair();

    const response = await app.inject({
      method: "PATCH",
      url: `/api/patients/${patientId}/status`,
      headers: { cookie: doctorCookie },
      payload: { status: "worsening" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().patient.status).toBe("worsening");
    expect(response.json().patient.statusLabel).toBe("Ухудшение");
    await app.close();
  });

  it("refuses an unknown status", async () => {
    const { app, doctorCookie, patientId } = await boundPair();

    const response = await app.inject({
      method: "PATCH",
      url: `/api/patients/${patientId}/status`,
      headers: { cookie: doctorCookie },
      payload: { status: "remission" },
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it("refuses a patient and another doctor", async () => {
    const { app, doctorCookie, patientCookie, patientId } = await boundPair();

    const byPatient = await app.inject({
      method: "PATCH",
      url: `/api/patients/${patientId}/status`,
      headers: { cookie: patientCookie },
      payload: { status: "treatment" },
    });
    expect(byPatient.statusCode).toBe(403);

    const otherDoctor = await signUpDoctor(app, {
      email: "other@example.com",
      password: "another good password",
    });
    const byOther = await app.inject({
      method: "PATCH",
      url: `/api/patients/${patientId}/status`,
      headers: { cookie: otherDoctor },
      payload: { status: "treatment" },
    });
    expect(byOther.statusCode).toBe(403);

    const mine = await app.inject({
      method: "PATCH",
      url: `/api/patients/${patientId}/status`,
      headers: { cookie: doctorCookie },
      payload: { status: "treatment" },
    });
    expect(mine.statusCode).toBe(200);
    await app.close();
  });
});
