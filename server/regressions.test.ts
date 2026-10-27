import { describe, expect, it } from "vitest";
import { bindPatient, newApp, signUpDoctor, signUpPatient, type App } from "./test-support.js";

/**
 * Each test here pins a defect found in review. They are cheap and they are the
 * reason a fixed bug cannot quietly come back.
 */

const PSYCHIATRIST = {
  email: "psychiatrist@example.com",
  password: "correct horse battery",
  specialty: "psychiatrist" as const,
};

/** Этап приходит с врачом (SPEC S3, Q49): терапевт — скрининг, психиатр — терапия. */
async function boundPair(
  app: App,
  options: { email?: string; specialty?: "therapist" | "psychiatrist" } = {},
) {
  const doctorCookie =
    options.specialty === "psychiatrist"
      ? await signUpDoctor(app, PSYCHIATRIST)
      : await signUpDoctor(app);
  const patientCookie = await signUpPatient(
    app,
    options.email ? { email: options.email, password: "patient password" } : undefined,
  );
  await bindPatient(app, patientCookie, doctorCookie);
  const me = await app.inject({ method: "GET", url: "/api/me", headers: { cookie: patientCookie } });
  return { doctorCookie, patientCookie, patientId: me.json().profile.id as string };
}

const submitPhq9 = (
  app: App,
  cookie: string,
  perItem: number,
  submissionId: string = crypto.randomUUID(),
) =>
  app.inject({
    method: "POST",
    url: "/api/assessments/phq-9",
    headers: { cookie },
    payload: {
      submissionId,
      answers: Object.fromEntries(
        Array.from({ length: 9 }, (_, index) => [`q${index + 1}`, index === 8 ? 0 : perItem]),
      ),
    },
  });

describe("signal wording follows the instrument", () => {
  it("names the band the score actually falls in", async () => {
    const app = await newApp();
    const { doctorCookie, patientCookie } = await boundPair(app);
    await submitPhq9(app, patientCookie, 2); // 16 of 27 — moderately severe, not severe

    const signals = await app.inject({ method: "GET", url: "/api/signals", headers: { cookie: doctorCookie } });
    const total = signals.json().signals.find((signal: { kind: string }) => signal.kind === "severe_total");

    // Шкала в заголовке: «16 из 27» без имени заставляло угадывать инструмент.
    expect(total.title).toBe("PHQ-9: умеренно выраженные проявления — 16 из 27");
    await app.close();
  });

  it("names the questionnaire, so «14 из 21» cannot be read as PHQ-9", async () => {
    const app = await newApp();
    const { doctorCookie, patientCookie } = await boundPair(app, { specialty: "psychiatrist" });

    await app.inject({
      method: "POST",
      url: "/api/assessments/hads-anxiety",
      headers: { cookie: patientCookie },
      payload: {
        submissionId: "hads-band-test",
        answers: Object.fromEntries(Array.from({ length: 7 }, (_, index) => [`a${index + 1}`, 2])),
      },
    });

    const signals = await app.inject({ method: "GET", url: "/api/signals", headers: { cookie: doctorCookie } });
    const total = signals
      .json()
      .signals.find((signal: { kind: string }) => signal.kind === "severe_total");

    expect(total.title).toBe("HADS-Т: клинически выраженная — 14 из 21");
    await app.close();
  });

  it("says «выраженные» only when the severe band is reached", async () => {
    const app = await newApp();
    const { doctorCookie, patientCookie } = await boundPair(app);
    await submitPhq9(app, patientCookie, 3); // 24 of 27

    const signals = await app.inject({ method: "GET", url: "/api/signals", headers: { cookie: doctorCookie } });
    const total = signals.json().signals.find((signal: { kind: string }) => signal.kind === "severe_total");

    expect(total.title).toBe("PHQ-9: выраженные проявления — 24 из 27");
    await app.close();
  });
});

describe("a check-in date is a plain day", () => {
  it("refuses a timestamp that would not match the stored day", async () => {
    const app = await newApp();
    const { doctorCookie, patientCookie, patientId } = await boundPair(app, {
      specialty: "psychiatrist",
    });
    const created = await app.inject({
      method: "POST",
      url: `/api/patients/${patientId}/plan`,
      headers: { cookie: doctorCookie },
      payload: { kind: "medication", title: "Сертралин 50 мг" },
    });
    await app.inject({
      method: "POST",
      url: `/api/plan/${created.json().item.id}/confirm`,
      headers: { cookie: doctorCookie },
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/checkins",
      headers: { cookie: patientCookie },
      payload: {
        planItemId: created.json().item.id,
        status: "done",
        checkinDate: new Date().toISOString(),
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("invalid_request");
    await app.close();
  });
});

describe("a signal cannot be closed before it is taken", () => {
  it("refuses saved -> closed", async () => {
    const app = await newApp();
    const { doctorCookie, patientCookie } = await boundPair(app);
    await submitPhq9(app, patientCookie, 3);
    const signals = await app.inject({ method: "GET", url: "/api/signals", headers: { cookie: doctorCookie } });
    const signal = signals.json().signals[0];

    const response = await app.inject({
      method: "POST",
      url: `/api/signals/${signal.id}/close`,
      headers: { cookie: doctorCookie },
      payload: { outcome: "Посмотрел, всё в порядке" },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe("wrong_status");
    await app.close();
  });
});

describe("archived prescriptions keep their adherence", () => {
  it("still shows what the patient did before the item was archived", async () => {
    const app = await newApp();
    const { doctorCookie, patientCookie, patientId } = await boundPair(app, {
      specialty: "psychiatrist",
    });
    const created = await app.inject({
      method: "POST",
      url: `/api/patients/${patientId}/plan`,
      headers: { cookie: doctorCookie },
      payload: { kind: "medication", title: "Сертралин 50 мг" },
    });
    const itemId = created.json().item.id as string;
    await app.inject({ method: "POST", url: `/api/plan/${itemId}/confirm`, headers: { cookie: doctorCookie } });
    await app.inject({
      method: "POST",
      url: "/api/checkins",
      headers: { cookie: patientCookie },
      payload: { planItemId: itemId, status: "done" },
    });
    await app.inject({ method: "POST", url: `/api/plan/${itemId}/archive`, headers: { cookie: doctorCookie } });

    const adherence = await app.inject({
      method: "GET",
      url: `/api/patients/${patientId}/checkins`,
      headers: { cookie: doctorCookie },
    });

    expect(adherence.json().items).toHaveLength(1);
    expect(adherence.json().items[0].status).toBe("archived");
    expect(adherence.json().items[0].done).toBe(1);
    await app.close();
  });
});

describe("submission ids are per patient", () => {
  it("lets two patients use the same id and still returns each one's own result", async () => {
    const app = await newApp();
    const shared = "same-id-for-both";

    // One doctor, two patients on the same code: the id is per patient, not global.
    const doctorCookie = await signUpDoctor(app);
    const code = await app.inject({
      method: "GET",
      url: "/api/binding-code",
      headers: { cookie: doctorCookie },
    });

    const bind = async (email: string) => {
      const cookie = await signUpPatient(app, { email, password: "patient password" });
      await app.inject({
        method: "POST",
        url: "/api/bind",
        headers: { cookie },
        payload: { code: code.json().code },
      });
      return { patientCookie: cookie };
    };

    const first = await bind("anna@example.com");
    const second = await bind("mikhail@example.com");

    const a = await submitPhq9(app, first.patientCookie, 1, shared);
    const b = await submitPhq9(app, second.patientCookie, 1, shared);
    const retry = await submitPhq9(app, second.patientCookie, 1, shared);

    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(201);
    expect(retry.statusCode).toBe(200);
    expect(retry.json().assessment.id).toBe(b.json().assessment.id);
    await app.close();
  });
});
