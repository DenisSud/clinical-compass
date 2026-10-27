import { describe, expect, it } from "vitest";
import { shiftDay, wallClockDay, wallClockMinute } from "./prescriptions/schedule.js";
import { bindPatient, newApp, signUpDoctor, signUpPatient, type App } from "./test-support.js";
/** Назначает и ведёт план психиатр (SPEC S7, Q50): у терапевта этих маршрутов нет. */
const PSYCHIATRIST = {
  email: "psychiatrist@example.com",
  password: "correct horse battery",
  specialty: "psychiatrist" as const,
};

function today(): string {
  return wallClockDay(new Date());
}

/**
 * Запланированное время со сдвигом в часах от текущего момента: отрицательный — уже
 * наступило, положительный — ещё нет. Тесты не зависят от того, когда их запустили.
 */
function slotAt(hoursOffset: number): { scheduledAt: string; day: string; time: string } {
  const at = new Date(Date.now() + hoursOffset * 60 * 60 * 1000);
  const day = wallClockDay(at);
  const time = `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
  return { scheduledAt: `${day}T${time}`, day, time };
}

/** Запланированное время со сдвигом в минутах от текущей минуты: 0 — ровно сейчас. */
function minuteAt(minutesOffset: number): { scheduledAt: string; day: string; time: string } {
  const scheduledAt = wallClockMinute(new Date(Date.now() + minutesOffset * 60 * 1000));
  return { scheduledAt, day: scheduledAt.slice(0, 10), time: scheduledAt.slice(11) };
}

async function boundPair(app: App) {
  const doctorCookie = await signUpDoctor(app, PSYCHIATRIST);
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

describe("who may prescribe", () => {
  it("refuses a therapist to write a prescription and writes nothing", async () => {
    const app = await newApp();
    const therapistCookie = await signUpDoctor(app, {
      email: "therapist@example.com",
      password: "correct horse battery",
    });
    const patientCookie = await signUpPatient(app);
    await bindPatient(app, patientCookie, therapistCookie);
    const me = await app.inject({ method: "GET", url: "/api/me", headers: { cookie: patientCookie } });
    const patientId = me.json().profile.id as string;

    const response = await prescribe(app, therapistCookie, patientId);
    const list = await app.inject({
      method: "GET",
      url: `/api/patients/${patientId}/prescriptions`,
      headers: { cookie: therapistCookie },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().message).toMatch(/психиатр/);
    expect(list.statusCode).toBe(200);
    expect(list.json().prescriptions).toEqual([]);
    await app.close();
  });

  it("lets a therapist read what the psychiatrist prescribed, but not confirm or archive it", async () => {
    const app = await newApp();
    const { doctorCookie, patientCookie, patientId } = await boundPair(app);
    const draft = await prescribe(app, doctorCookie, patientId);

    // Передача терапевту: пациент меняет ведущего врача, назначения остаются.
    const therapistCookie = await signUpDoctor(app, {
      email: "therapist@example.com",
      password: "correct horse battery",
    });
    await bindPatient(app, patientCookie, therapistCookie);

    const read = await app.inject({
      method: "GET",
      url: `/api/patients/${patientId}/prescriptions`,
      headers: { cookie: therapistCookie },
    });
    const confirm = await app.inject({
      method: "POST",
      url: `/api/prescriptions/${draft.json().prescription.id}/confirm`,
      headers: { cookie: therapistCookie },
    });
    const archive = await app.inject({
      method: "POST",
      url: `/api/prescriptions/${draft.json().prescription.id}/archive`,
      headers: { cookie: therapistCookie },
    });

    expect(read.statusCode).toBe(200);
    expect(read.json().prescriptions).toHaveLength(1);
    expect(confirm.statusCode).toBe(403);
    expect(archive.statusCode).toBe(403);
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

describe("an intake that has not come yet", () => {
  it("refuses a mark on a time that is still ahead", async () => {
    const app = await newApp();
    const { doctorCookie, patientCookie, patientId } = await boundPair(app);
    const ahead = slotAt(2);
    const id = await confirmed(app, doctorCookie, patientId, {
      timesPerDay: 1,
      timesOfDay: [ahead.time],
      startsOn: ahead.day,
    });

    const response = await mark(app, patientCookie, {
      prescriptionId: id,
      scheduledAt: ahead.scheduledAt,
      status: "skipped",
      reason: "не было препарата",
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe("dose_in_future");
    expect(response.json().message.length).toBeGreaterThan(0);
    expect(
      (await app.inject({ method: "GET", url: "/api/signals", headers: { cookie: doctorCookie } }))
        .json()
        .signals,
    ).toEqual([]);
    await app.close();
  });

  it("accepts a mark once the planned time has come", async () => {
    const app = await newApp();
    const { doctorCookie, patientCookie, patientId } = await boundPair(app);
    const past = slotAt(-2);
    const id = await confirmed(app, doctorCookie, patientId, {
      timesPerDay: 1,
      timesOfDay: [past.time],
      startsOn: past.day,
    });

    const response = await mark(app, patientCookie, {
      prescriptionId: id,
      scheduledAt: past.scheduledAt,
      status: "taken",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().dose.status).toBe("taken");
    await app.close();
  });

  it("accepts a mark exactly on the current minute", async () => {
    const app = await newApp();
    const { doctorCookie, patientCookie, patientId } = await boundPair(app);
    const now = minuteAt(0);
    const id = await confirmed(app, doctorCookie, patientId, {
      timesPerDay: 1,
      timesOfDay: [now.time],
      startsOn: now.day,
    });

    const response = await mark(app, patientCookie, {
      prescriptionId: id,
      scheduledAt: now.scheduledAt,
      status: "taken",
    });

    // Приём в 12:00 в 12:00 уже наступил: граница минуты — решение, а не случайность.
    expect(response.statusCode).toBe(200);
    await app.close();
  });

  it("refuses a mark one minute ahead as a fact that has not happened", async () => {
    const app = await newApp();
    const { doctorCookie, patientCookie, patientId } = await boundPair(app);
    const ahead = minuteAt(1);
    const id = await confirmed(app, doctorCookie, patientId, {
      timesPerDay: 1,
      timesOfDay: [ahead.time],
      startsOn: ahead.day,
    });

    const response = await mark(app, patientCookie, {
      prescriptionId: id,
      scheduledAt: ahead.scheduledAt,
      status: "taken",
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe("dose_in_future");
    await app.close();
  });

  it("writes nothing when it refuses a mark on a time that is still ahead", async () => {
    const app = await newApp();
    const { doctorCookie, patientCookie, patientId } = await boundPair(app);
    const ahead = slotAt(2);
    const id = await confirmed(app, doctorCookie, patientId, {
      timesPerDay: 1,
      timesOfDay: [ahead.time],
      startsOn: ahead.day,
      endsOn: ahead.day,
    });

    await mark(app, patientCookie, {
      prescriptionId: id,
      scheduledAt: ahead.scheduledAt,
      status: "skipped",
      reason: "не было препарата",
    });

    const stored = app.conn.sqlite
      .prepare("SELECT COUNT(*) AS total FROM dose_event WHERE prescription_id = ?")
      .get(id) as { total: number };
    expect(stored.total).toBe(0);
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
      startsOn: shiftDay(today(), -3),
      endsOn: shiftDay(today(), -1),
    });

    await skipDays(app, patientCookie, id, [shiftDay(today(), -3), shiftDay(today(), -2)]);
    const before = await app.inject({
      method: "GET",
      url: "/api/signals",
      headers: { cookie: doctorCookie },
    });
    await skipDays(app, patientCookie, id, [shiftDay(today(), -1)]);
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
    expect(missed[0].detail).toContain("АВИАНДР");
    await app.close();
  });

  it("takes the card, its severity and its source from the rule file", async () => {
    const app = await newApp();
    const { doctorCookie, patientCookie, patientId } = await boundPair(app);
    const id = await confirmed(app, doctorCookie, patientId, {
      timesPerDay: 1,
      timesOfDay: ["08:00"],
      startsOn: shiftDay(today(), -3),
      endsOn: shiftDay(today(), -1),
    });

    await skipDays(app, patientCookie, id, [
      shiftDay(today(), -3),
      shiftDay(today(), -2),
      shiftDay(today(), -1),
    ]);
    const [missed] = (
      await app.inject({ method: "GET", url: "/api/signals", headers: { cookie: doctorCookie } })
    )
      .json()
      .signals.filter((signal: { kind: string }) => signal.kind === "missed_doses");

    // Карточка — то же правило, что лежит в content/rules: medium и плейсхолдер,
    // а не придуманные роутом high и пустой источник.
    expect(missed).toMatchObject({
      severity: "medium",
      ruleId: "adherence-three-missed-doses",
      ruleTitle: "Три пропуска приёма подряд",
      ruleSource: { kind: "ours", status: "placeholder" },
    });
    // Из шаблона правила — счёт; от движка — то, чего в шаблоне нет: препарат, доза,
    // времена пропущенных приёмов и причины, названные пациентом (issue #45).
    expect(missed.detail).toContain("Пропущено подряд: 3");
    expect(missed.detail).toContain("«АВИАНДР», 20 мг");
    expect(missed.detail).toContain(
      [shiftDay(today(), -3), shiftDay(today(), -2), shiftDay(today(), -1)]
        .map((day) => `${day.slice(8, 10)}.${day.slice(5, 7)}, 08:00`)
        .join(", "),
    );
    expect(missed.detail).toContain("Причины: не было препарата");
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
      startsOn: shiftDay(today(), -2),
      endsOn: shiftDay(today(), -1),
    });

    // Вечер позавчера, утро и вечер вчера — три подряд меньше чем за сутки.
    for (const scheduledAt of [
      `${shiftDay(today(), -2)}T20:00`,
      `${shiftDay(today(), -1)}T08:00`,
      `${shiftDay(today(), -1)}T20:00`,
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
