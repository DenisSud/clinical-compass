import { describe, expect, it } from "vitest";
import { newApp, setPatientStatus, signUpDoctor, signUpPatient, type App } from "./test-support.js";

function answers(value: number) {
  return Object.fromEntries(Array.from({ length: 9 }, (_, index) => [`q${index + 1}`, value]));
}

function submitAssessment(app: App, cookie: string, value = 1) {
  return app.inject({
    method: "POST",
    url: "/api/assessments/phq-9",
    headers: { cookie },
    payload: { submissionId: crypto.randomUUID(), answers: answers(value) },
  });
}

function submitDiary(app: App, cookie: string, payload: Record<string, unknown>) {
  return app.inject({
    method: "POST",
    url: "/api/diary",
    headers: { cookie },
    payload: { submissionId: crypto.randomUUID(), ...payload },
  });
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

describe("the diary is one entry per day", () => {
  it("refuses a second entry for the same day", async () => {
    const app = await newApp();
    const cookie = await signUpPatient(app);

    const first = await submitDiary(app, cookie, { value: 6, entryDate: today() });
    const second = await submitDiary(app, cookie, { value: 8, entryDate: today() });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe("already_recorded");
    await app.close();
  });

  it("still returns the first entry when the same submission is retried", async () => {
    const app = await newApp();
    const cookie = await signUpPatient(app);
    const payload = { submissionId: "retry", value: 5, entryDate: today() };

    const first = await app.inject({ method: "POST", url: "/api/diary", headers: { cookie }, payload });
    const retry = await app.inject({ method: "POST", url: "/api/diary", headers: { cookie }, payload });

    expect(first.statusCode).toBe(201);
    expect(retry.statusCode).toBe(200);
    expect(retry.json().entry.id).toBe(first.json().entry.id);
    await app.close();
  });

  it("accepts yesterday and refuses a date far from today", async () => {
    const app = await newApp();
    const cookie = await signUpPatient(app);

    expect((await submitDiary(app, cookie, { value: 4, entryDate: daysAgo(1) })).statusCode).toBe(201);
    const far = await submitDiary(app, cookie, { value: 4, entryDate: daysAgo(30) });

    expect(far.statusCode).toBe(400);
    await app.close();
  });

  it("lets the next day through", async () => {
    const app = await newApp();
    const cookie = await signUpPatient(app);

    await submitDiary(app, cookie, { value: 4, entryDate: daysAgo(1) });
    const next = await submitDiary(app, cookie, { value: 7, entryDate: today() });

    expect(next.statusCode).toBe(201);
    await app.close();
  });
});

describe("the questionnaire is weekly", () => {
  it("refuses a second attempt within a week", async () => {
    const app = await newApp();
    const cookie = await signUpPatient(app);

    const first = await submitAssessment(app, cookie);
    const second = await submitAssessment(app, cookie);

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe("too_soon");
    expect(second.json().message).toMatch(/Следующий раз/);
    await app.close();
  });

  it("does not let the refusal block a retry of the same submission", async () => {
    const app = await newApp();
    const cookie = await signUpPatient(app);
    const payload = { submissionId: "one", answers: answers(1) };

    await app.inject({ method: "POST", url: "/api/assessments/phq-9", headers: { cookie }, payload });
    const retry = await app.inject({
      method: "POST",
      url: "/api/assessments/phq-9",
      headers: { cookie },
      payload,
    });

    expect(retry.statusCode).toBe(200);
    await app.close();
  });

  it("reports no waiting time once the week has passed", async () => {
    const app = await newApp();
    const cookie = await signUpPatient(app);
    await submitAssessment(app, cookie);
    app.conn.sqlite
      .prepare("UPDATE assessments SET submitted_at = ?")
      .run(new Date(Date.now() - 8 * 86_400_000).toISOString());

    const response = await app.inject({ method: "GET", url: "/api/assessments", headers: { cookie } });

    expect(response.json().nextAllowedAt).toBeNull();
    await app.close();
  });

  it("opens again after seven days", async () => {
    const app = await newApp();
    const cookie = await signUpPatient(app);
    await submitAssessment(app, cookie);

    app.conn.sqlite
      .prepare("UPDATE assessments SET submitted_at = ?")
      .run(new Date(Date.now() - 8 * 86_400_000).toISOString());

    expect((await submitAssessment(app, cookie, 2)).statusCode).toBe(201);
    await app.close();
  });

  it("tells the patient when the next attempt opens", async () => {
    const app = await newApp();
    const cookie = await signUpPatient(app);
    expect(
      (await app.inject({ method: "GET", url: "/api/assessments", headers: { cookie } })).json()
        .nextAllowedAt,
    ).toBeNull();

    await submitAssessment(app, cookie);
    const response = await app.inject({ method: "GET", url: "/api/assessments", headers: { cookie } });

    const next = new Date(response.json().nextAllowedAt).getTime();
    expect(next).toBeGreaterThan(Date.now() + 6 * 86_400_000);
    expect(response.json().assessments).toHaveLength(1);
    await app.close();
  });
});

describe("the interval belongs to the instrument", () => {
  /** ASQ живёт в терапии, поэтому паре нужен врач: статус ставит он, не пациент. */
  async function treatmentPair(app: App) {
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
    await setPatientStatus(app, doctorCookie, me.json().profile.id as string, "treatment");
    return { doctorCookie, patientCookie, patientId: me.json().profile.id as string };
  }

  function submitAsq(app: App, cookie: string, answer = 0) {
    return app.inject({
      method: "POST",
      url: "/api/assessments/asq",
      headers: { cookie },
      payload: {
        submissionId: crypto.randomUUID(),
        answers: Object.fromEntries(
          ["q1", "q2", "q3", "q4"].map((id) => [id, answer]),
        ),
      },
    });
  }

  it("asks ASQ again at any time, because a risk screener cannot be locked", async () => {
    const app = await newApp();
    const { patientCookie: cookie } = await treatmentPair(app);

    const first = await submitAsq(app, cookie);
    const second = await submitAsq(app, cookie);

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    await app.close();
  });

  it("does not lock a patient out of ASQ after a low score", async () => {
    const app = await newApp();
    const { patientCookie: cookie } = await treatmentPair(app);

    await submitAsq(app, cookie, 0);
    const afterCrisis = await submitAsq(app, cookie, 1);

    expect(afterCrisis.statusCode).toBe(201);
    await app.close();
  });

  it("keeps PHQ-9 weekly while ASQ is open", async () => {
    const app = await newApp();
    const { doctorCookie, patientCookie: cookie, patientId } = await treatmentPair(app);
    await setPatientStatus(app, doctorCookie, patientId, "screening");

    await submitAssessment(app, cookie);
    await setPatientStatus(app, doctorCookie, patientId, "treatment");
    await submitAsq(app, cookie);
    await setPatientStatus(app, doctorCookie, patientId, "screening");
    const again = await submitAssessment(app, cookie);

    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe("too_soon");
    await app.close();
  });
});
