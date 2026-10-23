import { describe, expect, it } from "vitest";
import { newApp, signUpDoctor, signUpPatient, type App } from "./test-support.js";

function post(app: App, cookie: string, payload: unknown) {
  return app.inject({
    method: "POST",
    url: "/api/diary",
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

describe("the wellbeing diary", () => {
  it("accepts a score with a comment", async () => {
    const app = await newApp();
    const cookie = await signUpPatient(app);

    const response = await post(app, cookie, { submissionId: "d-1", value: 7, comment: "спал плохо" });

    expect(response.statusCode).toBe(201);
    expect(response.json().entry).toMatchObject({ value: 7, comment: "спал плохо" });
    await app.close();
  });

  it("accepts a score without a comment", async () => {
    const app = await newApp();
    const cookie = await signUpPatient(app);

    const response = await post(app, cookie, { submissionId: "d-1", value: 4 });

    expect(response.statusCode).toBe(201);
    expect(response.json().entry.comment).toBeNull();
    await app.close();
  });

  it("refuses a score outside 1..10", async () => {
    const app = await newApp();
    const cookie = await signUpPatient(app);

    for (const value of [0, 11, -3, 4.5]) {
      const response = await post(app, cookie, { submissionId: `bad-${value}`, value });
      expect(response.statusCode, `value ${value}`).toBe(400);
    }
    await app.close();
  });

  it("does not write the same submission twice", async () => {
    const app = await newApp();
    const cookie = await signUpPatient(app);

    const first = await post(app, cookie, { submissionId: "same", value: 5 });
    const second = await post(app, cookie, { submissionId: "same", value: 9 });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.json().entry.value).toBe(5);
    await app.close();
  });

  it("keeps a doctor out of the diary route", async () => {
    const app = await newApp();
    const cookie = await signUpDoctor(app);

    expect((await post(app, cookie, { submissionId: "d", value: 5 })).statusCode).toBe(403);
    await app.close();
  });

  it("shows the patient only their own entries", async () => {
    const app = await newApp();
    const mine = await signUpPatient(app);
    const theirs = await signUpPatient(app, { email: "other@example.com", password: "other password" });

    await post(app, mine, { submissionId: "a", value: 3 });
    await post(app, theirs, { submissionId: "b", value: 8 });

    const response = await app.inject({ method: "GET", url: "/api/diary", headers: { cookie: mine } });

    expect(response.json().entries).toHaveLength(1);
    expect(response.json().entries[0].value).toBe(3);
    await app.close();
  });

  it("shows the doctor their patient's entries, newest first", async () => {
    const app = await newApp();
    const { doctorCookie, patientCookie, patientId } = await boundPair(app);
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    await post(app, patientCookie, { submissionId: "old", value: 2, entryDate: yesterday });
    await post(app, patientCookie, { submissionId: "new", value: 9 });

    const response = await app.inject({
      method: "GET",
      url: `/api/patients/${patientId}/diary`,
      headers: { cookie: doctorCookie },
    });

    expect(response.json().entries.map((entry: { value: number }) => entry.value)).toEqual([9, 2]);
    await app.close();
  });

  it("keeps another doctor out", async () => {
    const app = await newApp();
    const { patientId } = await boundPair(app);
    const stranger = await signUpDoctor(app, { email: "other@example.com", password: "other password" });

    const response = await app.inject({
      method: "GET",
      url: `/api/patients/${patientId}/diary`,
      headers: { cookie: stranger },
    });

    expect(response.statusCode).toBe(403);
    await app.close();
  });
});
