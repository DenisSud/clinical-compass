import { describe, expect, it } from "vitest";
import { shiftDay, wallClockDay } from "./prescriptions/schedule.js";
import { newApp, signUpDoctor, signUpPatient, type App } from "./test-support.js";

function today(): string {
  return wallClockDay(new Date());
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

function prescribe(app: App, cookie: string, patientId: string, overrides: Record<string, unknown> = {}) {
  return app.inject({
    method: "POST",
    url: `/api/patients/${patientId}/prescriptions`,
    headers: { cookie },
    payload: {
      drugId: "aviandr-smpc",
      drugName: "АВИАНДР",
      doseValue: 20,
      doseUnit: "мг",
      timesPerDay: 2,
      timesOfDay: ["08:00", "20:00"],
      startsOn: today(),
      ...overrides,
    },
  });
}

async function confirmed(app: App, cookie: string, patientId: string, overrides: Record<string, unknown> = {}) {
  const created = await prescribe(app, cookie, patientId, overrides);
  expect(created.statusCode).toBe(201);
  const id = created.json().prescription.id as string;
  const confirmedAt = await app.inject({
    method: "POST",
    url: `/api/prescriptions/${id}/confirm`,
    headers: { cookie },
  });
  expect(confirmedAt.statusCode).toBe(200);
  return id;
}

function mark(
  app: App,
  cookie: string,
  payload: { prescriptionId: string; scheduledAt: string; status: string; reason?: string },
) {
  return app.inject({ method: "POST", url: "/api/doses", headers: { cookie }, payload });
}

describe("writing a prescription", () => {
  it("keeps an unconfirmed prescription out of the pillbox", async () => {
    const app = await newApp();
    const { doctorCookie, patientCookie, patientId } = await boundPair(app);

    const created = await prescribe(app, doctorCookie, patientId);
    const before = await app.inject({
      method: "GET",
      url: "/api/prescriptions",
      headers: { cookie: patientCookie },
    });
    await app.inject({
      method: "POST",
      url: `/api/prescriptions/${created.json().prescription.id}/confirm`,
      headers: { cookie: doctorCookie },
    });
    const after = await app.inject({
      method: "GET",
      url: "/api/prescriptions",
      headers: { cookie: patientCookie },
    });

    expect(created.json().prescription.status).toBe("draft");
    expect(before.json()).toMatchObject({ today: today(), doses: [] });
    expect(after.json().doses).toHaveLength(2);
    await app.close();
  });

  it("records which doctor confirmed the prescription", async () => {
    const app = await newApp();
    const { doctorCookie, patientCookie, patientId } = await boundPair(app);
    await confirmed(app, doctorCookie, patientId);
    const doctorId = (
      await app.inject({ method: "GET", url: "/api/me", headers: { cookie: doctorCookie } })
    ).json<{ profile: { id: string } }>().profile.id;

    const response = await app.inject({
      method: "GET",
      url: `/api/patients/${patientId}/prescriptions`,
      headers: { cookie: doctorCookie },
    });

    const [view] = response.json().prescriptions;
    expect(view.prescription.status).toBe("active");
    expect(view.prescription.confirmedBy).toBe(doctorId);
    expect(view.prescription.confirmedAt).not.toBeNull();
    await app.close();
  });

  it("refuses a schedule that does not add up", async () => {
    const app = await newApp();
    const { doctorCookie, patientId } = await boundPair(app);

    expect(
      (await prescribe(app, doctorCookie, patientId, { timesPerDay: 2, timesOfDay: ["08:00"] }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await prescribe(app, doctorCookie, patientId, {
          timesPerDay: 2,
          timesOfDay: ["08:00", "08:00"],
        })
      ).statusCode,
    ).toBe(400);
    expect((await prescribe(app, doctorCookie, patientId, { timesOfDay: ["25:00", "26:00"] })).statusCode).toBe(
      400,
    );
    await app.close();
  });

  it("refuses a drug the reference does not have", async () => {
    const app = await newApp();
    const { doctorCookie, patientId } = await boundPair(app);

    const response = await prescribe(app, doctorCookie, patientId, { drugId: "no-such-drug" });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("unknown_drug");
    await app.close();
  });
});

describe("the pillbox", () => {
  it("records an intake against the planned time and measures the delay", async () => {
    const app = await newApp();
    const { doctorCookie, patientCookie, patientId } = await boundPair(app);
    const id = await confirmed(app, doctorCookie, patientId, {
      timesPerDay: 1,
      timesOfDay: ["00:00"],
    });

    const saved = await mark(app, patientCookie, {
      prescriptionId: id,
      scheduledAt: `${today()}T00:00`,
      status: "taken",
    });

    expect(saved.statusCode).toBe(200);
    expect(saved.json().dose.status).toBe("taken");
    expect(saved.json().dose.takenAt).not.toBeNull();
    await app.close();
  });

  it("shows the doctor the adherence of the patient by planned time", async () => {
    const app = await newApp();
    const { doctorCookie, patientCookie, patientId } = await boundPair(app);
    const id = await confirmed(app, doctorCookie, patientId, {
      timesPerDay: 1,
      timesOfDay: ["00:00"],
    });
    await mark(app, patientCookie, {
      prescriptionId: id,
      scheduledAt: `${today()}T00:00`,
      status: "taken",
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/patients/${patientId}/prescriptions`,
      headers: { cookie: doctorCookie },
    });

    const [view] = response.json().prescriptions;
    expect(view.adherence).toMatchObject({ taken: 1, skipped: 0 });
    expect(view.slots[0].lateMinutes).not.toBeNull();
    await app.close();
  });

  it("corrects a mis-tap instead of keeping two answers for one intake", async () => {
    const app = await newApp();
    const { doctorCookie, patientCookie, patientId } = await boundPair(app);
    const id = await confirmed(app, doctorCookie, patientId, {
      timesPerDay: 1,
      timesOfDay: ["00:00"],
    });
    const scheduledAt = `${today()}T00:00`;

    await mark(app, patientCookie, { prescriptionId: id, scheduledAt, status: "skipped", reason: "забыл" });
    const corrected = await mark(app, patientCookie, { prescriptionId: id, scheduledAt, status: "taken" });

    const response = await app.inject({
      method: "GET",
      url: `/api/patients/${patientId}/prescriptions`,
      headers: { cookie: doctorCookie },
    });
    const [view] = response.json().prescriptions;

    expect(corrected.statusCode).toBe(200);
    expect(view.slots[0].state).toBe("taken");
    expect(view.adherence).toMatchObject({ taken: 1, skipped: 0 });
    await app.close();
  });

  it("refuses a skip without a reason", async () => {
    const app = await newApp();
    const { doctorCookie, patientCookie, patientId } = await boundPair(app);
    const id = await confirmed(app, doctorCookie, patientId, {
      timesPerDay: 1,
      timesOfDay: ["00:00"],
    });

    const response = await mark(app, patientCookie, {
      prescriptionId: id,
      scheduledAt: `${today()}T00:00`,
      status: "skipped",
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it("refuses a time that is not in the schedule", async () => {
    const app = await newApp();
    const { doctorCookie, patientCookie, patientId } = await boundPair(app);
    const id = await confirmed(app, doctorCookie, patientId, {
      timesPerDay: 1,
      timesOfDay: ["00:00"],
    });

    const response = await mark(app, patientCookie, {
      prescriptionId: id,
      scheduledAt: `${today()}T13:37`,
      status: "taken",
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it("refuses an intake on a prescription the doctor has not confirmed", async () => {
    const app = await newApp();
    const { doctorCookie, patientCookie, patientId } = await boundPair(app);
    const created = await prescribe(app, doctorCookie, patientId, {
      timesPerDay: 1,
      timesOfDay: ["00:00"],
    });

    const response = await mark(app, patientCookie, {
      prescriptionId: created.json().prescription.id,
      scheduledAt: `${today()}T00:00`,
      status: "taken",
    });

    expect(response.statusCode).toBe(409);
    await app.close();
  });
});

describe("three missed intakes in a row", () => {
  async function skipDays(
    app: App,
    patientCookie: string,
    prescriptionId: string,
    days: string[],
  ): Promise<void> {
    for (const day of days) {
      const response = await mark(app, patientCookie, {
        prescriptionId,
        scheduledAt: `${day}T08:00`,
        status: "skipped",
        reason: "не было препарата",
      });
      expect(response.statusCode).toBe(200);
    }
  }

  it("raises a signal the doctor sees", async () => {
    const app = await newApp();
    const { doctorCookie, patientCookie, patientId } = await boundPair(app);
    const id = await confirmed(app, doctorCookie, patientId, {
      timesPerDay: 1,
      timesOfDay: ["08:00"],
      startsOn: shiftDay(today(), -2),
    });

    await skipDays(app, patientCookie, id, [shiftDay(today(), -2), shiftDay(today(), -1)]);
    const before = await app.inject({
      method: "GET",
      url: "/api/signals",
      headers: { cookie: doctorCookie },
    });
    await skipDays(app, patientCookie, id, [today()]);
    const after = await app.inject({
      method: "GET",
      url: "/api/signals",
      headers: { cookie: doctorCookie },
    });

    expect(before.json().signals).toEqual([]);
    const missed = after
      .json()
      .signals.filter((signal: { kind: string }) => signal.kind === "missed_doses");
    expect(missed).toHaveLength(1);
    expect(missed[0].severity).toBe("high");
    expect(missed[0].detail).toContain("АВИАНДР");
    await app.close();
  });

  it("is not raised while one of the intakes has no data", async () => {
    const app = await newApp();
    const { doctorCookie, patientCookie, patientId } = await boundPair(app);
    const id = await confirmed(app, doctorCookie, patientId, {
      timesPerDay: 1,
      timesOfDay: ["08:00"],
      startsOn: shiftDay(today(), -3),
      endsOn: shiftDay(today(), -1),
    });

    // Два пропуска, а третий день не отмечен. «Нет данных» — это не пропуск, и
    // правило не имеет права дочитать его до трёх.
    await skipDays(app, patientCookie, id, [shiftDay(today(), -3), shiftDay(today(), -2)]);
    const signals = await app.inject({
      method: "GET",
      url: "/api/signals",
      headers: { cookie: doctorCookie },
    });
    const prescriptionsView = await app.inject({
      method: "GET",
      url: `/api/patients/${patientId}/prescriptions`,
      headers: { cookie: doctorCookie },
    });

    expect(prescriptionsView.json().prescriptions[0].adherence).toMatchObject({
      scheduled: 3,
      skipped: 2,
      noData: 1,
      consecutiveSkips: 0,
    });
    expect(signals.json().signals).toEqual([]);
    await app.close();
  });

  it("counts two intakes a day by their planned times, not by days", async () => {
    const app = await newApp();
    const { doctorCookie, patientCookie, patientId } = await boundPair(app);
    const id = await confirmed(app, doctorCookie, patientId, {
      startsOn: shiftDay(today(), -1),
    });

    // Вечер вчера, утро и вечер сегодня — три подряд меньше чем за сутки.
    for (const scheduledAt of [
      `${shiftDay(today(), -1)}T20:00`,
      `${today()}T08:00`,
      `${today()}T20:00`,
    ]) {
      const response = await mark(app, patientCookie, {
        prescriptionId: id,
        scheduledAt,
        status: "skipped",
        reason: "не было препарата",
      });
      expect(response.statusCode).toBe(200);
    }

    const response = await app.inject({
      method: "GET",
      url: "/api/signals",
      headers: { cookie: doctorCookie },
    });

    expect(
      response.json().signals.filter((signal: { kind: string }) => signal.kind === "missed_doses"),
    ).toHaveLength(1);
    await app.close();
  });
});

describe("who may see and mark a prescription", () => {
  it("does not let one patient mark another patient's intake", async () => {
    const app = await newApp();
    const { doctorCookie, patientCookie, patientId } = await boundPair(app);
    const id = await confirmed(app, doctorCookie, patientId, {
      timesPerDay: 1,
      timesOfDay: ["00:00"],
    });
    const strangerCookie = await signUpPatient(app, {
      email: "stranger@example.com",
      password: "stranger password",
    });

    const response = await mark(app, strangerCookie, {
      prescriptionId: id,
      scheduledAt: `${today()}T00:00`,
      status: "taken",
    });

    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it("does not let one patient read another patient's pillbox", async () => {
    const app = await newApp();
    const { doctorCookie, patientId } = await boundPair(app);
    await confirmed(app, doctorCookie, patientId);
    const strangerCookie = await signUpPatient(app, {
      email: "stranger@example.com",
      password: "stranger password",
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/prescriptions",
      headers: { cookie: strangerCookie },
    });

    expect(response.json().doses).toEqual([]);
    await app.close();
  });

  it("keeps another doctor out of the adherence summary", async () => {
    const app = await newApp();
    const { doctorCookie, patientId } = await boundPair(app);
    await confirmed(app, doctorCookie, patientId);
    const strangerCookie = await signUpDoctor(app, {
      email: "stranger@example.com",
      password: "stranger password",
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/patients/${patientId}/prescriptions`,
      headers: { cookie: strangerCookie },
    });

    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it("keeps another doctor from confirming someone else's prescription", async () => {
    const app = await newApp();
    const { doctorCookie, patientId } = await boundPair(app);
    const created = await prescribe(app, doctorCookie, patientId);
    const strangerCookie = await signUpDoctor(app, {
      email: "stranger@example.com",
      password: "stranger password",
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/prescriptions/${created.json().prescription.id}/confirm`,
      headers: { cookie: strangerCookie },
    });

    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it("keeps a patient off the doctor's prescription routes", async () => {
    const app = await newApp();
    const { patientCookie, patientId } = await boundPair(app);

    const response = await prescribe(app, patientCookie, patientId);

    expect(response.statusCode).toBe(403);
    await app.close();
  });
});
