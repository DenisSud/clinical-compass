import { describe, expect, it } from "vitest";
import type { WatchItem } from "../shared/contracts.js";
import { signalsForWatchItems } from "./rules/watch.js";
import { bindPatient, newApp, signUpDoctor, signUpPatient, type App } from "./test-support.js";

const watch = (overrides: Partial<WatchItem> = {}): WatchItem => ({
  id: "w1",
  patientId: "p1",
  kind: "diary_below",
  title: "Плохое самочувствие",
  severity: "high",
  params: { threshold: 3 },
  status: "active",
  createdAt: "2026-10-23T10:00:00.000Z",
  pausedAt: null,
  ...overrides,
});

describe("the doctor's own rules", () => {
  it("fires when the diary drops to the threshold", () => {
    const drafts = signalsForWatchItems([watch()], { type: "diary", value: 3, previousValue: 6 });

    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.watchItemId).toBe("w1");
    expect(drafts[0]?.severity).toBe("high");
  });

  it("stays quiet one point above the threshold", () => {
    expect(signalsForWatchItems([watch()], { type: "diary", value: 4, previousValue: 6 })).toEqual([]);
  });

  it("does not fire a paused rule", () => {
    expect(
      signalsForWatchItems([watch({ status: "paused" })], { type: "diary", value: 1, previousValue: 6 }),
    ).toEqual([]);
  });

  it("needs a previous entry before it can call something a drop", () => {
    const drop = watch({ kind: "diary_drop", params: { points: 3 } });

    expect(signalsForWatchItems([drop], { type: "diary", value: 2, previousValue: null })).toEqual([]);
    expect(signalsForWatchItems([drop], { type: "diary", value: 2, previousValue: 6 })).toHaveLength(1);
  });

  it("matches a keyword in a message regardless of case", () => {
    const keywords = watch({ kind: "message_keyword", params: { terms: ["не хочу жить"] } });

    const drafts = signalsForWatchItems([keywords], {
      type: "message",
      text: "Здравствуйте. Не хочу жить, сил больше нет.",
    });

    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.detail).toContain("не хочу жить");
  });

  it("ignores a questionnaire rule meant for another instrument", () => {
    const score = watch({ kind: "score_threshold", params: { instrumentId: "phq-9", threshold: 10 } });

    expect(signalsForWatchItems([score], { type: "assessment", instrumentId: "hads", total: 20 })).toEqual([]);
    expect(signalsForWatchItems([score], { type: "assessment", instrumentId: "phq-9", total: 20 })).toHaveLength(1);
  });

  it("counts consecutive skips only", () => {
    const missed = watch({ kind: "missed_doses", params: { days: 2 } });

    expect(signalsForWatchItems([missed], { type: "checkin", consecutiveSkips: 1 })).toEqual([]);
    expect(signalsForWatchItems([missed], { type: "checkin", consecutiveSkips: 2 })).toHaveLength(1);
  });
});

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

describe("watch routes", () => {
  it("lets the doctor add a rule and pause it", async () => {
    const app = await newApp();
    const { doctorCookie, patientId } = await boundPair(app);

    const created = await app.inject({
      method: "POST",
      url: `/api/patients/${patientId}/watch`,
      headers: { cookie: doctorCookie },
      payload: { kind: "diary_below", title: "Плохое самочувствие", severity: "high", threshold: 3 },
    });
    const paused = await app.inject({
      method: "POST",
      url: `/api/watch/${created.json().item.id}/pause`,
      headers: { cookie: doctorCookie },
    });

    expect(created.statusCode).toBe(201);
    expect(created.json().item.params.threshold).toBe(3);
    expect(paused.json().item.status).toBe("paused");
    await app.close();
  });

  it("pauses a rule even when the client announces JSON with an empty body", async () => {
    const app = await newApp();
    const { doctorCookie, patientId } = await boundPair(app);

    const created = await app.inject({
      method: "POST",
      url: `/api/patients/${patientId}/watch`,
      headers: { cookie: doctorCookie },
      payload: { kind: "diary_below", title: "Плохое самочувствие", severity: "high", threshold: 3 },
    });

    // Exactly what the browser used to send: a content-type with no body at all.
    const paused = await app.inject({
      method: "POST",
      url: `/api/watch/${created.json().item.id}/pause`,
      headers: { cookie: doctorCookie, "content-type": "application/json" },
    });

    expect(paused.statusCode).toBe(200);
    expect(paused.json().item.status).toBe("paused");
    await app.close();
  });

  it("keeps a refusal a refusal instead of dressing it as a server error", async () => {
    const app = await newApp();
    const { doctorCookie, patientId } = await boundPair(app);

    const response = await app.inject({
      method: "POST",
      url: `/api/patients/${patientId}/watch`,
      headers: { cookie: doctorCookie, "content-type": "application/json" },
      payload: '{"kind": ',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).not.toBe("internal");
    await app.close();
  });

  it("rejects a rule without its parameter", async () => {
    const app = await newApp();
    const { doctorCookie, patientId } = await boundPair(app);

    const response = await app.inject({
      method: "POST",
      url: `/api/patients/${patientId}/watch`,
      headers: { cookie: doctorCookie },
      payload: { kind: "diary_below", title: "Без порога", severity: "high" },
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it("raises a signal from a patient message", async () => {
    const app = await newApp();
    const { doctorCookie, patientCookie, patientId } = await boundPair(app);
    await app.inject({
      method: "POST",
      url: `/api/patients/${patientId}/watch`,
      headers: { cookie: doctorCookie },
      payload: {
        kind: "message_keyword",
        title: "Риск самоповреждения",
        severity: "critical",
        terms: ["не хочу жить"],
      },
    });

    await app.inject({
      method: "POST",
      url: "/api/messages",
      headers: { cookie: patientCookie },
      payload: { body: "Не хочу жить, всё бессмысленно" },
    });

    const signals = await app.inject({
      method: "GET",
      url: "/api/signals",
      headers: { cookie: doctorCookie },
    });

    expect(signals.json().signals).toHaveLength(1);
    expect(signals.json().signals[0].title).toBe("Риск самоповреждения");
    expect(signals.json().signals[0].severity).toBe("critical");
    await app.close();
  });

  it("gives the doctor the scales the patient actually has, to choose a threshold rule on", async () => {
    const app = await newApp();
    const { doctorCookie, patientId } = await boundPair(app);

    const response = await app.inject({
      method: "GET",
      url: `/api/patients/${patientId}/instruments`,
      headers: { cookie: doctorCookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().instruments.map((item: { id: string }) => item.id)).toEqual(["phq-9"]);
    await app.close();
  });

  it("refuses a threshold rule on a scale that does not exist", async () => {
    const app = await newApp();
    const { doctorCookie, patientId } = await boundPair(app);

    const response = await app.inject({
      method: "POST",
      url: `/api/patients/${patientId}/watch`,
      headers: { cookie: doctorCookie },
      payload: {
        kind: "score_threshold",
        title: "Порог по шкале, которой нет",
        severity: "high",
        instrumentId: "hads",
        threshold: 10,
      },
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it("raises a threshold rule on the HADS the patient actually fills in", async () => {
    const app = await newApp();
    const { patientCookie, patientId } = await boundPair(app);
    // HADS живёт в терапии: набор шкал приходит вместе с психиатром (SPEC S3, Q49).
    const psychiatristCookie = await signUpDoctor(app, {
      email: "psychiatrist@example.com",
      password: "correct horse battery",
      specialty: "psychiatrist",
    });
    await bindPatient(app, patientCookie, psychiatristCookie);

    await app.inject({
      method: "POST",
      url: `/api/patients/${patientId}/watch`,
      headers: { cookie: psychiatristCookie },
      payload: {
        kind: "score_threshold",
        title: "Тревога выросла",
        severity: "high",
        instrumentId: "hads-anxiety",
        threshold: 11,
      },
    });

    await app.inject({
      method: "POST",
      url: "/api/assessments/hads-anxiety",
      headers: { cookie: patientCookie },
      payload: {
        submissionId: "hads-threshold",
        answers: { a1: 3, a2: 3, a3: 3, a4: 3, a5: 3, a6: 3, a7: 3 },
      },
    });

    const signals = await app.inject({
      method: "GET",
      url: "/api/signals",
      headers: { cookie: psychiatristCookie },
    });
    const raised = (signals.json().signals as Array<{ title: string; ruleId: string | null }>).filter(
      (signal) => signal.title === "Тревога выросла",
    );

    expect(raised).toHaveLength(1);
    await app.close();
  });

  it("keeps another doctor out", async () => {
    const app = await newApp();
    const { patientId } = await boundPair(app);
    const stranger = await signUpDoctor(app, { email: "other@example.com", password: "other password" });

    const response = await app.inject({
      method: "GET",
      url: `/api/patients/${patientId}/watch`,
      headers: { cookie: stranger },
    });

    expect(response.statusCode).toBe(403);
    await app.close();
  });
});
