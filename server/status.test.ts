import { describe, expect, it } from "vitest";
import { bindPatient, newApp, signUpDoctor, signUpPatient } from "./test-support.js";

const PSYCHIATRIST = {
  email: "psychiatrist@example.com",
  password: "correct horse battery",
  specialty: "psychiatrist" as const,
};

async function boundPair(specialty: "therapist" | "psychiatrist" = "therapist") {
  const app = await newApp();
  const doctorCookie =
    specialty === "psychiatrist" ? await signUpDoctor(app, PSYCHIATRIST) : await signUpDoctor(app);
  const patientCookie = await signUpPatient(app);

  await bindPatient(app, patientCookie, doctorCookie);

  const me = await app.inject({ method: "GET", url: "/api/me", headers: { cookie: patientCookie } });
  return { app, doctorCookie, patientCookie, patientId: me.json().profile.id as string };
}

/** HADS-тревога: семь пунктов a1…a7, у каждого свои варианты ответа со значением 1. */
function hadsAnswers(value: number): Record<string, number> {
  return Object.fromEntries(Array.from({ length: 7 }, (_, index) => [`a${index + 1}`, value]));
}

function instrumentIds(body: { instruments: { id: string }[] }): string[] {
  return body.instruments.map((instrument) => instrument.id);
}

describe("этап пациента", () => {
  it("это этап терапевта, с набором скрининга", async () => {
    const { app, patientCookie } = await boundPair();

    const response = await app.inject({
      method: "GET",
      url: "/api/instruments",
      headers: { cookie: patientCookie },
    });

    expect(response.statusCode).toBe(200);
    expect(instrumentIds(response.json())).toEqual(["phq-9"]);
    await app.close();
  });

  it("это этап психиатра, с HADS и UKU", async () => {
    const { app, patientCookie } = await boundPair("psychiatrist");

    const response = await app.inject({
      method: "GET",
      url: "/api/instruments",
      headers: { cookie: patientCookie },
    });

    expect(instrumentIds(response.json())).toEqual(["hads-anxiety", "hads-depression", "uku"]);
    await app.close();
  });

  it("следует за переводом к психиатру и обратно, без отдельного переключателя", async () => {
    const { app, patientCookie } = await boundPair();
    const psychiatristCookie = await signUpDoctor(app, PSYCHIATRIST);
    const therapistCookie = await signUpDoctor(app, {
      email: "therapist@example.com",
      password: "correct horse battery",
    });

    await bindPatient(app, patientCookie, psychiatristCookie);
    const inTreatment = await app.inject({
      method: "GET",
      url: "/api/instruments",
      headers: { cookie: patientCookie },
    });
    expect(instrumentIds(inTreatment.json())).toEqual(["hads-anxiety", "hads-depression", "uku"]);

    await bindPatient(app, patientCookie, therapistCookie);
    const inScreening = await app.inject({
      method: "GET",
      url: "/api/instruments",
      headers: { cookie: patientCookie },
    });
    expect(instrumentIds(inScreening.json())).toEqual(["phq-9"]);
    await app.close();
  });

  it("отказывает в инструменте, которого этап не назначает, как будто его нет", async () => {
    const { app, patientCookie } = await boundPair();

    const response = await app.inject({
      method: "GET",
      url: "/api/instruments/hads-anxiety",
      headers: { cookie: patientCookie },
    });

    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it("отказывает в отправке инструмента вне этапа", async () => {
    const { app, patientCookie } = await boundPair();
    const answers = hadsAnswers(1);

    const response = await app.inject({
      method: "POST",
      url: "/api/assessments/hads-anxiety",
      headers: { cookie: patientCookie },
      payload: { submissionId: "outside", answers },
    });

    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it("никогда не даёт пациенту заполнить шкалу врача", async () => {
    const { app, patientCookie } = await boundPair("psychiatrist");

    const form = await app.inject({
      method: "GET",
      url: "/api/instruments/hdrs-17",
      headers: { cookie: patientCookie },
    });
    const submission = await app.inject({
      method: "POST",
      url: "/api/assessments/hdrs-17",
      headers: { cookie: patientCookie },
      payload: { submissionId: "hdrs", answers: { h01: 1 } },
    });

    expect(form.statusCode).toBe(404);
    expect(submission.statusCode).toBe(404);
    await app.close();
  });

  it("говорит, когда опросник откроется снова, и только про уже пройденный", async () => {
    const { app, patientCookie } = await boundPair("psychiatrist");
    await app.inject({
      method: "POST",
      url: "/api/assessments/hads-anxiety",
      headers: { cookie: patientCookie },
      payload: { submissionId: "one", answers: hadsAnswers(1) },
    });

    const list = await app.inject({
      method: "GET",
      url: "/api/instruments",
      headers: { cookie: patientCookie },
    });
    const byId = new Map(
      (list.json().instruments as { id: string; nextAttemptAt: string | null }[]).map((item) => [
        item.id,
        item.nextAttemptAt,
      ]),
    );

    expect(byId.get("hads-anxiety")).toMatch(/^20\d\d-/);
    expect(byId.get("uku")).toBeNull();
    await app.close();
  });

  it("никогда не отправляет этап пациенту", async () => {
    const { app, patientCookie } = await boundPair("psychiatrist");

    const me = await app.inject({ method: "GET", url: "/api/me", headers: { cookie: patientCookie } });
    const list = await app.inject({
      method: "GET",
      url: "/api/instruments",
      headers: { cookie: patientCookie },
    });

    expect(me.json().profile).not.toHaveProperty("status");
    expect(JSON.stringify(list.json())).not.toContain("treatment");
    expect(JSON.stringify(list.json())).not.toContain("screening");
    await app.close();
  });
});

describe("взгляд врача на этап", () => {
  it("читает этап в карточке пациента", async () => {
    const { app, doctorCookie, patientId } = await boundPair("psychiatrist");

    const response = await app.inject({
      method: "GET",
      url: `/api/patients/${patientId}`,
      headers: { cookie: doctorCookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().patient.status).toBe("treatment");
    expect(response.json().patient.statusLabel).toBe("Терапия");
    await app.close();
  });

  it("не имеет маршрута, чтобы двигать этап вручную", async () => {
    const { app, doctorCookie, patientId } = await boundPair();

    const response = await app.inject({
      method: "PATCH",
      url: `/api/patients/${patientId}/status`,
      headers: { cookie: doctorCookie },
      payload: { status: "treatment" },
    });

    expect(response.statusCode).toBe(404);
    await app.close();
  });
});
