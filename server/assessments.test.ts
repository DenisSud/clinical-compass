import { describe, expect, it } from "vitest";
import { bindPatient, newApp, signUpDoctor, signUpPatient, type App } from "./test-support.js";

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

const PSYCHIATRIST = {
  email: "psychiatrist@example.com",
  password: "correct horse battery",
  specialty: "psychiatrist" as const,
};

/**
 * Пара «врач — пациент». Этап приходит с врачом: у терапевта скрининг, у психиатра
 * терапия (SPEC S3, Q49), поэтому отдельного переключателя этапа здесь нет.
 */
async function boundPair(app: App, specialty: "therapist" | "psychiatrist" = "therapist") {
  const doctorCookie =
    specialty === "psychiatrist" ? await signUpDoctor(app, PSYCHIATRIST) : await signUpDoctor(app);
  const patientCookie = await signUpPatient(app);
  await bindPatient(app, patientCookie, doctorCookie);

  const me = await app.inject({ method: "GET", url: "/api/me", headers: { cookie: patientCookie } });
  return { doctorCookie, patientCookie, patientId: me.json().profile.id as string };
}

describe("отправка опросника", () => {
  it("сохраняет ответы и возвращает их без суммы", async () => {
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

  it("возвращает первый результат, когда та же отправка приходит дважды", async () => {
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

  it("отказывает в наполовину заполненном опроснике", async () => {
    const app = await newApp();
    const cookie = await signUpPatient(app);

    const response = await submit(app, cookie, { submissionId: "half", answers: { q1: 1 } });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("invalid_request");
    await app.close();
  });

  it("отказывает в значении вне шкалы", async () => {
    const app = await newApp();
    const cookie = await signUpPatient(app);

    const response = await submit(app, cookie, {
      submissionId: "wild",
      answers: answers(0, { q4: 9 }),
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it("отказывает в неизвестном инструменте", async () => {
    const app = await newApp();
    const cookie = await signUpPatient(app);

    const response = await submit(app, cookie, { submissionId: "x", answers: answers(0) }, "hads");

    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it("не пускает врача на маршрут отправки", async () => {
    const app = await newApp();
    const cookie = await signUpDoctor(app);

    const response = await submit(app, cookie, { submissionId: "x", answers: answers(0) });

    expect(response.statusCode).toBe(403);
    await app.close();
  });
});

describe("чтение оценок", () => {
  it("показывает пациенту только его историю", async () => {
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

  it("показывает врачу сумму и полосу", async () => {
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

  it("отмечает пункт 9 для врача, когда на него ответили", async () => {
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

  it("не пускает другого врача", async () => {
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

  it("не пускает пациента на маршрут врача", async () => {
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

/** HADS-тревога нумерует пункты a1…a7, UKU — u01…u48; у каждого пункта свои варианты. */
function hadsAnswers(value: number, overrides: Record<string, number> = {}) {
  return {
    ...Object.fromEntries(Array.from({ length: 7 }, (_, index) => [`a${index + 1}`, value])),
    ...overrides,
  };
}

function ukuAnswers(value: number, overrides: Record<string, number> = {}) {
  return {
    ...Object.fromEntries(
      Array.from({ length: 48 }, (_, index) => [`u${String(index + 1).padStart(2, "0")}`, value]),
    ),
    ...overrides,
  };
}

describe("набор психиатра", () => {
  it("принимает отправку HADS и не показывает сумму пациенту", async () => {
    const app = await newApp();
    const { patientCookie } = await boundPair(app, "psychiatrist");

    const response = await submit(
      app,
      patientCookie,
      { submissionId: "h-1", answers: hadsAnswers(2) },
      "hads-anxiety",
    );

    expect(response.statusCode).toBe(201);
    expect(response.json().assessment.answers).toHaveLength(7);
    expect(response.json().assessment).not.toHaveProperty("total");
    expect(response.json().assessment).not.toHaveProperty("band");
    await app.close();
  });

  it("показывает врачу сумму HADS и её полосу", async () => {
    const app = await newApp();
    const { doctorCookie, patientCookie, patientId } = await boundPair(app, "psychiatrist");
    await submit(
      app,
      patientCookie,
      { submissionId: "h-1", answers: hadsAnswers(2) },
      "hads-anxiety",
    );

    const response = await app.inject({
      method: "GET",
      url: `/api/patients/${patientId}/assessments`,
      headers: { cookie: doctorCookie },
    });

    const [assessment] = response.json().assessments;
    expect(assessment.instrumentId).toBe("hads-anxiety");
    expect(assessment.total).toBe(14);
    expect(assessment.band.label).toBe("Клинически выраженная");
    await app.close();
  });

  it("принимает отправку UKU по всем 48 пунктам и не отмечает критический пункт", async () => {
    const app = await newApp();
    const { doctorCookie, patientCookie, patientId } = await boundPair(app, "psychiatrist");

    const submitted = await submit(
      app,
      patientCookie,
      { submissionId: "u-1", answers: ukuAnswers(0, { u12: 3 }) },
      "uku",
    );
    const response = await app.inject({
      method: "GET",
      url: `/api/patients/${patientId}/assessments`,
      headers: { cookie: doctorCookie },
    });

    expect(submitted.statusCode).toBe(201);
    expect(submitted.json().assessment.answers).toHaveLength(48);
    expect(response.json().assessments[0].criticalItems).toEqual([]);
    await app.close();
  });

  it("не показывает врачу сумму UKU: общей суммы у шкалы нет", async () => {
    const app = await newApp();
    const { doctorCookie, patientCookie, patientId } = await boundPair(app, "psychiatrist");
    await submit(
      app,
      patientCookie,
      { submissionId: "u-1", answers: ukuAnswers(0, { u12: 3 }) },
      "uku",
    );

    const response = await app.inject({
      method: "GET",
      url: `/api/patients/${patientId}/assessments`,
      headers: { cookie: doctorCookie },
    });

    const [assessment] = response.json().assessments;
    expect(assessment.instrumentId).toBe("uku");
    // Числа нет, а не ноль: ноль читался бы как ответ по шкале (SPEC S10).
    expect(assessment.total).toBeNull();
    expect(assessment.band.label).toBe("Общей суммы нет");
    await app.close();
  });

  it("при наборе психиатра критический пункт PHQ-9 всё равно поднимает сигнал", async () => {
    const app = await newApp();
    const { patientCookie } = await boundPair(app);

    // PHQ-9 — скрининг. История терапии начинается после передачи психиатру: этап
    // меняется вместе с ведущим врачом, а не кнопкой (Q49).
    await submit(app, patientCookie, { submissionId: "p-1", answers: answers(0, { q9: 1 }) });
    const psychiatristCookie = await signUpDoctor(app, PSYCHIATRIST);
    await bindPatient(app, patientCookie, psychiatristCookie);
    await submit(
      app,
      patientCookie,
      { submissionId: "u-1", answers: ukuAnswers(0) },
      "uku",
    );
    await submit(
      app,
      patientCookie,
      { submissionId: "h-1", answers: hadsAnswers(0) },
      "hads-anxiety",
    );

    const signals = await app.inject({
      method: "GET",
      url: "/api/signals",
      headers: { cookie: psychiatristCookie },
    });
    const critical = signals
      .json()
      .signals.filter((signal: { kind: string }) => signal.kind === "critical_item");

    expect(critical).toHaveLength(1);
    expect(critical[0].severity).toBe("critical");
    await app.close();
  });

  it("отказывает в HADS пациенту, который ещё на скрининге", async () => {
    const app = await newApp();
    const cookie = await signUpPatient(app);

    const response = await submit(
      app,
      cookie,
      { submissionId: "h-1", answers: hadsAnswers(0) },
      "hads-anxiety",
    );

    expect(response.statusCode).toBe(404);
    await app.close();
  });
});
