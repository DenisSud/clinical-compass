import { describe, expect, it } from "vitest";
import { newApp, signUpDoctor, signUpPatient, type App } from "./test-support.js";
/** Назначает и ведёт план психиатр (SPEC S7, Q50): у терапевта этих маршрутов нет. */
const PSYCHIATRIST = {
  email: "psychiatrist@example.com",
  password: "correct horse battery",
  specialty: "psychiatrist" as const,
};

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

async function activeItem(app: App, doctorCookie: string, patientId: string, title = "Сертралин 50 мг") {
  const created = await app.inject({
    method: "POST",
    url: `/api/patients/${patientId}/plan`,
    headers: { cookie: doctorCookie },
    payload: { kind: "medication", title },
  });
  const id = created.json().item.id as string;
  await app.inject({
    method: "POST",
    url: `/api/plan/${id}/confirm`,
    headers: { cookie: doctorCookie },
  });
  return id;
}

const mark = (app: App, cookie: string, planItemId: string, status: string, reason?: string) =>
  app.inject({
    method: "POST",
    url: "/api/checkins",
    headers: { cookie },
    payload: { planItemId, status, reason },
  });

describe("the patient's daily check-in", () => {
  it("shows only what is actually prescribed today", async () => {
    const app = await newApp();
    const { doctorCookie, patientCookie, patientId } = await boundPair(app);
    await app.inject({
      method: "POST",
      url: `/api/patients/${patientId}/plan`,
      headers: { cookie: doctorCookie },
      payload: { kind: "medication", title: "Черновик" },
    });
    await activeItem(app, doctorCookie, patientId);

    const response = await app.inject({ method: "GET", url: "/api/checkins", headers: { cookie: patientCookie } });

    expect(response.statusCode).toBe(200);
    expect(response.json().items).toHaveLength(1);
    expect(response.json().items[0].title).toBe("Сертралин 50 мг");
    expect(response.json().items[0].status).toBeNull();
    await app.close();
  });

  it("records a dose and shows it back", async () => {
    const app = await newApp();
    const { doctorCookie, patientCookie, patientId } = await boundPair(app);
    const itemId = await activeItem(app, doctorCookie, patientId);

    const marked = await mark(app, patientCookie, itemId, "done");
    const listed = await app.inject({ method: "GET", url: "/api/checkins", headers: { cookie: patientCookie } });

    expect(marked.statusCode).toBe(200);
    expect(listed.json().items[0].status).toBe("done");
    await app.close();
  });

  it("refuses a skip with no reason", async () => {
    const app = await newApp();
    const { doctorCookie, patientCookie, patientId } = await boundPair(app);
    const itemId = await activeItem(app, doctorCookie, patientId);

    const response = await mark(app, patientCookie, itemId, "skipped", "  ");

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("invalid_request");
    await app.close();
  });

  it("keeps the reason for a skip", async () => {
    const app = await newApp();
    const { doctorCookie, patientCookie, patientId } = await boundPair(app);
    const itemId = await activeItem(app, doctorCookie, patientId);

    await mark(app, patientCookie, itemId, "skipped", "Тошнило утром");
    const listed = await app.inject({ method: "GET", url: "/api/checkins", headers: { cookie: patientCookie } });

    expect(listed.json().items[0].status).toBe("skipped");
    expect(listed.json().items[0].reason).toBe("Тошнило утром");
    await app.close();
  });

  it("lets a mis-tap be corrected the same day", async () => {
    const app = await newApp();
    const { doctorCookie, patientCookie, patientId } = await boundPair(app);
    const itemId = await activeItem(app, doctorCookie, patientId);

    await mark(app, patientCookie, itemId, "done");
    await mark(app, patientCookie, itemId, "skipped", "Перепутал кнопку");

    const listed = await app.inject({ method: "GET", url: "/api/checkins", headers: { cookie: patientCookie } });
    expect(listed.json().items[0].status).toBe("skipped");
    await app.close();
  });

  it("refuses an item that is still a draft", async () => {
    const app = await newApp();
    const { doctorCookie, patientCookie, patientId } = await boundPair(app);
    const created = await app.inject({
      method: "POST",
      url: `/api/patients/${patientId}/plan`,
      headers: { cookie: doctorCookie },
      payload: { kind: "medication", title: "Черновик" },
    });

    const response = await mark(app, patientCookie, created.json().item.id, "done");

    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe("wrong_status");
    await app.close();
  });

  it("does not let a patient mark someone else's prescription", async () => {
    const app = await newApp();
    const { doctorCookie, patientId } = await boundPair(app);
    const itemId = await activeItem(app, doctorCookie, patientId);
    const strangerCookie = await signUpPatient(app, { email: "other@example.com", password: "other password" });

    const response = await mark(app, strangerCookie, itemId, "done");

    expect(response.statusCode).toBe(404);
    await app.close();
  });
});

describe("what the doctor sees", () => {
  it("keeps done, skipped and no data apart", async () => {
    const app = await newApp();
    const { doctorCookie, patientCookie, patientId } = await boundPair(app);
    const itemId = await activeItem(app, doctorCookie, patientId);

    await mark(app, patientCookie, itemId, "skipped", "Забыл дома");
    const response = await app.inject({
      method: "GET",
      url: `/api/patients/${patientId}/checkins`,
      headers: { cookie: doctorCookie },
    });

    const item = response.json().items[0];
    expect(item.skipped).toBe(1);
    expect(item.done).toBe(0);
    expect(item.days.at(-1).state).toBe("skipped");
    expect(item.days.at(-1).reason).toBe("Забыл дома");
    await app.close();
  });

  it("does not count days before the prescription as missing", async () => {
    const app = await newApp();
    const { doctorCookie, patientId } = await boundPair(app);
    await activeItem(app, doctorCookie, patientId);

    const response = await app.inject({
      method: "GET",
      url: `/api/patients/${patientId}/checkins?days=30`,
      headers: { cookie: doctorCookie },
    });

    const item = response.json().items[0];
    expect(item.days).toHaveLength(1);
    expect(item.startedAt).toBe(item.days[0].date);
    await app.close();
  });

  it("keeps another doctor out", async () => {
    const app = await newApp();
    const { patientId } = await boundPair(app);
    const stranger = await signUpDoctor(app, { email: "other@example.com", password: "other password" });

    const response = await app.inject({
      method: "GET",
      url: `/api/patients/${patientId}/checkins`,
      headers: { cookie: stranger },
    });

    expect(response.statusCode).toBe(403);
    await app.close();
  });
});
