import { describe, expect, it } from "vitest";
import { newApp, signUpDoctor, signUpPatient, type App } from "./test-support.js";

function answers(value: number, overrides: Record<string, number> = {}) {
  return {
    ...Object.fromEntries(Array.from({ length: 9 }, (_, index) => [`q${index + 1}`, value])),
    ...overrides,
  };
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

async function submit(app: App, cookie: string, value: number, overrides: Record<string, number> = {}) {
  const response = await app.inject({
    method: "POST",
    url: "/api/assessments/phq-9",
    headers: { cookie },
    payload: { submissionId: crypto.randomUUID(), answers: answers(value, overrides) },
  });
  expect(response.statusCode).toBe(201);
  return response;
}

function listSignals(app: App, cookie: string) {
  return app.inject({ method: "GET", url: "/api/signals", headers: { cookie } });
}

describe("what raises a signal", () => {
  it("raises a critical signal for item 9", async () => {
    const app = await newApp();
    const { doctorCookie, patientCookie } = await boundPair(app);
    await submit(app, patientCookie, 0, { q9: 1 });

    const signals = listSignals(app, doctorCookie).then((response) => response.json().signals);

    expect((await signals).map((signal: { kind: string }) => signal.kind)).toContain("critical_item");
    expect((await signals)[0].severity).toBe("critical");
    await app.close();
  });

  it("raises nothing for a low score with no critical answer", async () => {
    const app = await newApp();
    const { doctorCookie, patientCookie } = await boundPair(app);
    await submit(app, patientCookie, 0);

    expect((await listSignals(app, doctorCookie)).json().signals).toEqual([]);
    await app.close();
  });

  it("raises a high signal for a severe total", async () => {
    const app = await newApp();
    const { doctorCookie, patientCookie } = await boundPair(app);
    await submit(app, patientCookie, 2);

    const kinds = (await listSignals(app, doctorCookie)).json().signals.map((s: { kind: string }) => s.kind);
    expect(kinds).toContain("severe_total");
    await app.close();
  });

  it("raises a worsening signal only when there is something to compare", async () => {
    const app = await newApp();
    const { doctorCookie, patientCookie } = await boundPair(app);
    await submit(app, patientCookie, 0);
    expect((await listSignals(app, doctorCookie)).json().signals).toEqual([]);

    // the questionnaire is weekly, so age the first submission before the second
    app.conn.sqlite
      .prepare("UPDATE assessments SET submitted_at = ?")
      .run(new Date(Date.now() - 8 * 86_400_000).toISOString());

    await submit(app, patientCookie, 1, { q2: 2, q3: 2 });
    const kinds = (await listSignals(app, doctorCookie)).json().signals.map((s: { kind: string }) => s.kind);
    expect(kinds).toContain("worsening");
    await app.close();
  });

  it("names the scale and both sums when it calls a worsening", async () => {
    const app = await newApp();
    const { doctorCookie, patientCookie } = await boundPair(app);
    // PHQ-9: пять баллов на пяти пунктах.
    await submit(app, patientCookie, 0, { q1: 1, q2: 1, q3: 1, q4: 1, q5: 1 });
    app.conn.sqlite
      .prepare("UPDATE assessments SET submitted_at = ?")
      .run(new Date(Date.now() - 8 * 86_400_000).toISOString());

    // Та же шкала, десять баллов: девять единиц и двойка на первом пункте.
    await submit(app, patientCookie, 1, { q1: 2 });
    const [worsening] = (
      await listSignals(app, doctorCookie)
    )
      .json()
      .signals.filter((signal: { kind: string }) => signal.kind === "worsening");

    expect(worsening).toBeDefined();
    expect(worsening.title).toBe("Ухудшение на 5 балла");
    expect(worsening.detail).toContain("PHQ-9");
    expect(worsening.detail).toContain("предыдущая сумма — 5");
    expect(worsening.detail).toContain("текущая — 10");
    await app.close();
  });

  it("does not compare one questionnaire with another", async () => {
    const app = await newApp();
    const { doctorCookie, patientCookie } = await boundPair(app);

    // ASQ: один утвердительный ответ, сумма 1. PHQ-9 следом: сумма 6.
    // Числа рядом, но шкалы разные — сравнение выдало бы «ухудшение на 5»
    // у пациента, состояние которого не изменилось.
    const asq = await app.inject({
      method: "POST",
      url: "/api/assessments/asq",
      headers: { cookie: patientCookie },
      payload: { submissionId: crypto.randomUUID(), answers: { q1: 1, q2: 0, q3: 0, q4: 0 } },
    });
    expect(asq.statusCode).toBe(201);
    await submit(app, patientCookie, 0, { q1: 3, q2: 3 });

    const kinds = (await listSignals(app, doctorCookie)).json().signals.map((s: { kind: string }) => s.kind);
    expect(kinds).not.toContain("worsening");
    await app.close();
  });

  it("raises a signal for a very low diary score", async () => {
    const app = await newApp();
    const { doctorCookie, patientCookie } = await boundPair(app);
    await app.inject({
      method: "POST",
      url: "/api/diary",
      headers: { cookie: patientCookie },
      payload: { submissionId: "d-1", value: 2 },
    });

    const kinds = (await listSignals(app, doctorCookie)).json().signals.map((s: { kind: string }) => s.kind);
    expect(kinds).toContain("low_wellbeing");
    await app.close();
  });

  it("does not duplicate a signal when the same submission is retried", async () => {
    const app = await newApp();
    const { doctorCookie, patientCookie } = await boundPair(app);
    const payload = { submissionId: "same", answers: answers(3) };

    await app.inject({
      method: "POST",
      url: "/api/assessments/phq-9",
      headers: { cookie: patientCookie },
      payload,
    });
    await app.inject({
      method: "POST",
      url: "/api/assessments/phq-9",
      headers: { cookie: patientCookie },
      payload,
    });

    const signals = (await listSignals(app, doctorCookie)).json().signals;
    const kinds = signals.map((signal: { kind: string }) => signal.kind);
    expect(kinds.filter((kind: string) => kind === "severe_total")).toHaveLength(1);
    expect(kinds.filter((kind: string) => kind === "critical_item")).toHaveLength(1);
    await app.close();
  });
});

describe("the signal lifecycle", () => {
  it("moves saved to in_review and refuses a second take", async () => {
    const app = await newApp();
    const { doctorCookie, patientCookie } = await boundPair(app);
    await submit(app, patientCookie, 3);
    const [signal] = (await listSignals(app, doctorCookie)).json().signals;

    const take = await app.inject({
      method: "POST",
      url: `/api/signals/${signal.id}/take`,
      headers: { cookie: doctorCookie },
    });
    const again = await app.inject({
      method: "POST",
      url: `/api/signals/${signal.id}/take`,
      headers: { cookie: doctorCookie },
    });

    expect(take.statusCode).toBe(200);
    expect(take.json().signal.status).toBe("in_review");
    expect(again.statusCode).toBe(409);
    await app.close();
  });

  it("does not close a signal just because it was read", async () => {
    const app = await newApp();
    const { doctorCookie, patientCookie } = await boundPair(app);
    await submit(app, patientCookie, 3);

    await listSignals(app, doctorCookie);
    await listSignals(app, doctorCookie);

    expect((await listSignals(app, doctorCookie)).json().signals[0].status).toBe("saved");
    await app.close();
  });

  it("refuses to close without an outcome", async () => {
    const app = await newApp();
    const { doctorCookie, patientCookie } = await boundPair(app);
    await submit(app, patientCookie, 3);
    const [signal] = (await listSignals(app, doctorCookie)).json().signals;

    const response = await app.inject({
      method: "POST",
      url: `/api/signals/${signal.id}/close`,
      headers: { cookie: doctorCookie },
      payload: { outcome: "  " },
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it("closes with an outcome and keeps it", async () => {
    const app = await newApp();
    const { doctorCookie, patientCookie, patientId } = await boundPair(app);
    await submit(app, patientCookie, 3);
    const [signal] = (await listSignals(app, doctorCookie)).json().signals;

    await app.inject({
      method: "POST",
      url: `/api/signals/${signal.id}/take`,
      headers: { cookie: doctorCookie },
    });
    const closed = await app.inject({
      method: "POST",
      url: `/api/signals/${signal.id}/close`,
      headers: { cookie: doctorCookie },
      payload: { outcome: "Обсудили на приёме, план прежний" },
    });

    expect(closed.statusCode).toBe(200);
    expect(closed.json().signal).toMatchObject({
      status: "closed",
      outcome: "Обсудили на приёме, план прежний",
    });

    const mine = await app.inject({
      method: "GET",
      url: `/api/patients/${patientId}/signals`,
      headers: { cookie: doctorCookie },
    });
    expect(mine.json().signals[0].status).toBe("closed");
    await app.close();
  });

  it("keeps another doctor out of a signal", async () => {
    const app = await newApp();
    const { doctorCookie, patientCookie } = await boundPair(app);
    await submit(app, patientCookie, 3);
    const [signal] = (await listSignals(app, doctorCookie)).json().signals;

    const stranger = await signUpDoctor(app, { email: "other@example.com", password: "other password" });
    const take = await app.inject({
      method: "POST",
      url: `/api/signals/${signal.id}/take`,
      headers: { cookie: stranger },
    });
    const seen = await listSignals(app, stranger);

    expect(take.statusCode).toBe(403);
    expect(seen.json().signals).toEqual([]);
    await app.close();
  });

  it("keeps the patient out of the signal routes", async () => {
    const app = await newApp();
    const { patientCookie } = await boundPair(app);

    expect((await listSignals(app, patientCookie)).statusCode).toBe(403);
    await app.close();
  });
});

describe("ASQ does not multiply one answer into two findings", () => {
  async function submitAsq(app: App, cookie: string, value: number) {
    return app.inject({
      method: "POST",
      url: "/api/assessments/asq",
      headers: { cookie },
      payload: {
        submissionId: crypto.randomUUID(),
        answers: Object.fromEntries(["q1", "q2", "q3", "q4"].map((id) => [id, value])),
      },
    });
  }

  it("raises the critical signal and not a total-score signal on top of it", async () => {
    const app = await newApp();
    const { doctorCookie, patientCookie } = await boundPair(app);

    await submitAsq(app, patientCookie, 1);

    const signals = await app.inject({
      method: "GET",
      url: "/api/signals",
      headers: { cookie: doctorCookie },
    });
    const kinds = (signals.json().signals as Array<{ kind: string }>).map((signal) => signal.kind);

    // «Есть утвердительный ответ: 1 из 4» as a second card would read as a second
    // finding, and the number is a count, not a severity.
    expect(kinds).toContain("critical_item");
    expect(kinds).not.toContain("severe_total");
    await app.close();
  });
});

describe("the card says which rule fired", () => {
  it("names the rule and its placeholder source for the doctor", async () => {
    const app = await newApp();
    const { doctorCookie, patientCookie } = await boundPair(app);
    await submit(app, patientCookie, 0, { q9: 1 });

    const [signal] = (await listSignals(app, doctorCookie)).json().signals;

    expect(signal.kind).toBe("critical_item");
    expect(signal.ruleId).toBe("critical-item");
    expect(signal.ruleTitle).toBe("Критический пункт опросника");
    expect(signal.ruleSource).toMatchObject({
      kind: "ours",
      ref: "docs/research/ai-decision-logic/decisions.md#Q29",
      status: "placeholder",
    });
    await app.close();
  });

  it("points a diary card at the rule that raised it", async () => {
    const app = await newApp();
    const { doctorCookie, patientCookie } = await boundPair(app);
    await app.inject({
      method: "POST",
      url: "/api/diary",
      headers: { cookie: patientCookie },
      payload: { submissionId: "d-1", value: 2 },
    });

    const [signal] = (await listSignals(app, doctorCookie)).json().signals;

    expect(signal.ruleId).toBe("diary-low-wellbeing");
    expect(signal.ruleSource.status).toBe("placeholder");
    await app.close();
  });
});

describe("a signal names the questionnaire it came from", () => {
  it("says which instrument has the critical item, not just that one exists", async () => {
    const app = await newApp();
    const { doctorCookie, patientCookie } = await boundPair(app);

    await submit(app, patientCookie, 0, { q9: 1 });

    const signals = await app.inject({
      method: "GET",
      url: "/api/signals",
      headers: { cookie: doctorCookie },
    });
    const critical = (signals.json().signals as Array<{ kind: string; detail: string }>).find(
      (signal) => signal.kind === "critical_item",
    );

    // The doctor reads a card, not a rule id: without the title he has to guess
    // which form the patient filled in.
    expect(critical?.detail).toContain("PHQ-9");
    await app.close();
  });
});
