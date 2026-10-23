import { describe, expect, it } from "vitest";
import { newApp, signUpDoctor, signUpPatient, type App } from "./test-support.js";

function answers(value: number, overrides: Record<string, number> = {}) {
  const filled = Object.fromEntries(
    Array.from({ length: 9 }, (_, index) => [`q${index + 1}`, value]),
  );
  return { ...filled, ...overrides };
}

function submit(app: App, cookie: string, payload: unknown, instrumentId = "phq-9") {
  return app.inject({
    method: "POST",
    url: `/api/assessments/${instrumentId}`,
    headers: { cookie },
    payload: payload as Record<string, unknown>,
  });
}

async function boundPair(app: App) {
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
  return { doctorCookie, patientCookie, patientId: me.json().profile.id as string };
}

describe("submitting an assessment", () => {
  it("stores the answers and returns them without a score", async () => {
    const app = await newApp();
    const cookie = await signUpPatient(app);

    const response = await submit(app, cookie, { submissionId: "s-1", answers: answers(2) });

    expect(response.statusCode).toBe(201);
    const body = response.json().assessment;
    expect(body.answers).toHaveLength(9);
    expect(body).not.toHaveProperty("total");
    expect(body).not.toHaveProperty("band");
    await app.close();
  });

  it("returns the first result when the same submission arrives twice", async () => {
    const app = await newApp();
    const cookie = await signUpPatient(app);

    const first = await submit(app, cookie, { submissionId: "same", answers: answers(1) });
    const second = await submit(app, cookie, { submissionId: "same", answers: answers(3) });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.json().assessment.id).toBe(first.json().assessment.id);
    expect(second.json().assessment.answers[0].value).toBe(1);
    await app.close();
  });

  it("refuses a half-filled questionnaire", async () => {
    const app = await newApp();
    const cookie = await signUpPatient(app);

    const response = await submit(app, cookie, { submissionId: "half", answers: { q1: 1 } });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("invalid_request");
    await app.close();
  });

  it("refuses a value outside the scale", async () => {
    const app = await newApp();
    const cookie = await signUpPatient(app);

    const response = await submit(app, cookie, {
      submissionId: "wild",
      answers: answers(0, { q4: 9 }),
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it("refuses an unknown instrument", async () => {
    const app = await newApp();
    const cookie = await signUpPatient(app);

    const response = await submit(app, cookie, { submissionId: "x", answers: answers(0) }, "hads");

    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it("keeps a doctor out of the submission route", async () => {
    const app = await newApp();
    const cookie = await signUpDoctor(app);

    const response = await submit(app, cookie, { submissionId: "x", answers: answers(0) });

    expect(response.statusCode).toBe(403);
    await app.close();
  });
});

describe("reading assessments", () => {
  it("shows the patient only their own history", async () => {
    const app = await newApp();
    const mine = await signUpPatient(app);
    const theirs = await signUpPatient(app, { email: "other@example.com", password: "other password" });

    await submit(app, mine, { submissionId: "mine", answers: answers(1) });
    await submit(app, theirs, { submissionId: "theirs", answers: answers(2) });

    const response = await app.inject({
      method: "GET",
      url: "/api/assessments",
      headers: { cookie: mine },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().assessments).toHaveLength(1);
    await app.close();
  });

  it("shows the doctor the score and the band", async () => {
    const app = await newApp();
    const { doctorCookie, patientCookie, patientId } = await boundPair(app);
    await submit(app, patientCookie, { submissionId: "s-1", answers: answers(2) });

    const response = await app.inject({
      method: "GET",
      url: `/api/patients/${patientId}/assessments`,
      headers: { cookie: doctorCookie },
    });

    expect(response.statusCode).toBe(200);
    const [assessment] = response.json().assessments;
    expect(assessment.total).toBe(18);
    expect(assessment.band.label).toBe("Умеренно выраженные проявления");
    await app.close();
  });

  it("marks item 9 for the doctor when it is answered", async () => {
    const app = await newApp();
    const { doctorCookie, patientCookie, patientId } = await boundPair(app);
    await submit(app, patientCookie, { submissionId: "s-1", answers: answers(0, { q9: 2 }) });

    const response = await app.inject({
      method: "GET",
      url: `/api/patients/${patientId}/assessments`,
      headers: { cookie: doctorCookie },
    });

    expect(response.json().assessments[0].criticalItems).toEqual(["q9"]);
    await app.close();
  });

  it("keeps another doctor out", async () => {
    const app = await newApp();
    const { patientCookie, patientId } = await boundPair(app);
    await submit(app, patientCookie, { submissionId: "s-1", answers: answers(1) });

    const stranger = await signUpDoctor(app, { email: "other@example.com", password: "other password" });
    const response = await app.inject({
      method: "GET",
      url: `/api/patients/${patientId}/assessments`,
      headers: { cookie: stranger },
    });

    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it("keeps a patient off the doctor's route", async () => {
    const app = await newApp();
    const { patientCookie, patientId } = await boundPair(app);

    const response = await app.inject({
      method: "GET",
      url: `/api/patients/${patientId}/assessments`,
      headers: { cookie: patientCookie },
    });

    expect(response.statusCode).toBe(403);
    await app.close();
  });
});
