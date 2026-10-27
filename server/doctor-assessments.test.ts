import { describe, expect, it } from "vitest";
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

/** Пункты HDRS-17 нумеруются h01…h17, у каждого свои варианты ответа (0–4). */
function hdrsAnswers(value: number, overrides: Record<string, number> = {}) {
  return {
    ...Object.fromEntries(
      Array.from({ length: 17 }, (_, index) => [`h${String(index + 1).padStart(2, "0")}`, value]),
    ),
    ...overrides,
  };
}

async function boundPair(app: App, doctor: typeof PSYCHIATRIST | typeof THERAPIST = PSYCHIATRIST) {
  const doctorCookie = await signUpDoctor(app, doctor);
  const patientCookie = await signUpPatient(app);
  await bindPatient(app, patientCookie, doctorCookie);

  const me = await app.inject({ method: "GET", url: "/api/me", headers: { cookie: patientCookie } });
  return { doctorCookie, patientCookie, patientId: me.json().profile.id as string };
}

function submitDoctorAssessment(
  app: App,
  cookie: string,
  patientId: string,
  payload: unknown,
) {
  return app.inject({
    method: "POST",
    url: `/api/patients/${patientId}/doctor-assessments`,
    headers: { cookie },
    payload: payload as Record<string, unknown>,
  });
}

describe("оценка врача после приёма", () => {
  it("психиатр заполняет HDRS-17: сохраняется сумма и диапазон", async () => {
    const app = await newApp();
    const { doctorCookie, patientId } = await boundPair(app);

    const response = await submitDoctorAssessment(app, doctorCookie, patientId, {
      submissionId: "hdrs-1",
      instrumentId: "hdrs-17",
      answers: hdrsAnswers(1),
    });

    expect(response.statusCode).toBe(201);
    const stored = response.json().assessment;
    expect(stored.total).toBe(17);
    expect(stored.band.label).toBe("Средняя степень");

    // Тот же ответ читается карточкой врача: одна таблица, один диапазон.
    const card = await app.inject({
      method: "GET",
      url: `/api/patients/${patientId}/assessments`,
      headers: { cookie: doctorCookie },
    });
    const [row] = card.json().assessments;
    expect(row.instrumentTitle).toContain("HDRS-17");
    expect(row.total).toBe(17);
    expect(row.band.label).toBe("Средняя степень");
    await app.close();
  });

  it("повтор с тем же идентификатором отправки возвращает первую сумму", async () => {
    const app = await newApp();
    const { doctorCookie, patientId } = await boundPair(app);

    const first = await submitDoctorAssessment(app, doctorCookie, patientId, {
      submissionId: "same",
      instrumentId: "hdrs-17",
      answers: hdrsAnswers(1),
    });
    const second = await submitDoctorAssessment(app, doctorCookie, patientId, {
      submissionId: "same",
      instrumentId: "hdrs-17",
      answers: hdrsAnswers(2),
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.json().assessment.total).toBe(17);
    await app.close();
  });

  it("неполные ответы отклоняются, а не сохраняются с нулями", async () => {
    const app = await newApp();
    const { doctorCookie, patientId } = await boundPair(app);

    const response = await submitDoctorAssessment(app, doctorCookie, patientId, {
      submissionId: "half",
      instrumentId: "hdrs-17",
      answers: { h01: 1 },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("invalid_request");
    await app.close();
  });

  it("шкалу пациента врач этим маршрутом не заполняет", async () => {
    const app = await newApp();
    const { doctorCookie, patientId } = await boundPair(app);

    const response = await submitDoctorAssessment(app, doctorCookie, patientId, {
      submissionId: "wrong",
      instrumentId: "hads-anxiety",
      answers: { a1: 1 },
    });

    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it("терапевт шкалу врача не заполняет", async () => {
    const app = await newApp();
    const { doctorCookie, patientId } = await boundPair(app, THERAPIST);

    const response = await submitDoctorAssessment(app, doctorCookie, patientId, {
      submissionId: "hdrs-1",
      instrumentId: "hdrs-17",
      answers: hdrsAnswers(1),
    });

    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it("чужой психиатр оценку не ставит", async () => {
    const app = await newApp();
    const { patientId } = await boundPair(app);
    const stranger = await signUpDoctor(app, {
      email: "other@example.com",
      password: "other password",
      specialty: "psychiatrist",
    });

    const response = await submitDoctorAssessment(app, stranger, patientId, {
      submissionId: "hdrs-1",
      instrumentId: "hdrs-17",
      answers: hdrsAnswers(1),
    });

    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it("пациент оценку врача не ставит и не видит её в своих ответах", async () => {
    const app = await newApp();
    const { doctorCookie, patientCookie, patientId } = await boundPair(app);

    await submitDoctorAssessment(app, doctorCookie, patientId, {
      submissionId: "hdrs-1",
      instrumentId: "hdrs-17",
      answers: hdrsAnswers(1),
    });

    const asPatient = await submitDoctorAssessment(app, patientCookie, patientId, {
      submissionId: "hdrs-2",
      instrumentId: "hdrs-17",
      answers: hdrsAnswers(1),
    });
    expect(asPatient.statusCode).toBe(403);

    // Пациент не видит ни шкалу врача в наборе, ни её ответы в своей истории (SPEC S10).
    const instruments = await app.inject({
      method: "GET",
      url: "/api/instruments",
      headers: { cookie: patientCookie },
    });
    expect(
      (instruments.json().instruments as { id: string }[]).map((instrument) => instrument.id),
    ).not.toContain("hdrs-17");

    const mine = await app.inject({
      method: "GET",
      url: "/api/assessments",
      headers: { cookie: patientCookie },
    });
    expect(mine.json().assessments).toHaveLength(0);

    const byPatientRoute = await app.inject({
      method: "POST",
      url: "/api/assessments/hdrs-17",
      headers: { cookie: patientCookie },
      payload: { submissionId: "hdrs-3", answers: hdrsAnswers(1) },
    });
    expect(byPatientRoute.statusCode).toBe(404);
    await app.close();
  });
});

describe("шкала врача в карточке", () => {
  it("психиатр получает текст шкалы, а пациент — нет", async () => {
    const app = await newApp();
    const { doctorCookie, patientCookie, patientId } = await boundPair(app);

    const instruments = await app.inject({
      method: "GET",
      url: `/api/patients/${patientId}/doctor-instruments`,
      headers: { cookie: doctorCookie },
    });
    expect(instruments.statusCode).toBe(200);
    expect(instruments.json().instruments[0].id).toBe("hdrs-17");

    const view = await app.inject({
      method: "GET",
      url: `/api/patients/${patientId}/instruments/hdrs-17`,
      headers: { cookie: doctorCookie },
    });
    expect(view.statusCode).toBe(200);
    expect(view.json().instrument.items).toHaveLength(17);
    // Пациентский ответ на шкалу врача пациент не получает: маршрут врачебный.
    expect(view.json().instrument).not.toHaveProperty("bands");
    await app.close();
  });
});
