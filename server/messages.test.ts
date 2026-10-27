import { describe, expect, it } from "vitest";
import { newApp, signUpDoctor, signUpPatient, type App } from "./test-support.js";

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

describe("сообщения", () => {
  it("проводит вопрос и ответ по порядку", async () => {
    const app = await newApp();
    const { doctorCookie, patientCookie, patientId } = await boundPair(app);

    await app.inject({
      method: "POST",
      url: "/api/messages",
      headers: { cookie: patientCookie },
      payload: { body: "Стало хуже спать, это нормально?" },
    });
    await app.inject({
      method: "POST",
      url: `/api/patients/${patientId}/messages`,
      headers: { cookie: doctorCookie },
      payload: { body: "Да, первые две недели бывает. Продолжайте." },
    });

    const thread = await app.inject({ method: "GET", url: "/api/messages", headers: { cookie: patientCookie } });
    const rows = thread.json().messages;

    expect(rows).toHaveLength(2);
    expect(rows[0].authorRole).toBe("patient");
    expect(rows[1].authorRole).toBe("doctor");
    await app.close();
  });

  it("показывает врачу ленту его пациента", async () => {
    const app = await newApp();
    const { doctorCookie, patientCookie, patientId } = await boundPair(app);
    await app.inject({
      method: "POST",
      url: "/api/messages",
      headers: { cookie: patientCookie },
      payload: { body: "Можно перенести приём?" },
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/patients/${patientId}/messages`,
      headers: { cookie: doctorCookie },
    });

    expect(response.json().messages).toHaveLength(1);
    await app.close();
  });

  it("отказывает в пустом сообщении", async () => {
    const app = await newApp();
    const { patientCookie } = await boundPair(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/messages",
      headers: { cookie: patientCookie },
      payload: { body: "   " },
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it("не пускает другого врача в ленту", async () => {
    const app = await newApp();
    const { patientId } = await boundPair(app);
    const stranger = await signUpDoctor(app, { email: "other@example.com", password: "other password" });

    const response = await app.inject({
      method: "GET",
      url: `/api/patients/${patientId}/messages`,
      headers: { cookie: stranger },
    });

    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it("не даёт пациенту писать в чужую ленту", async () => {
    const app = await newApp();
    const { patientId } = await boundPair(app);
    const other = await signUpPatient(app, { email: "other@example.com", password: "other password" });

    const response = await app.inject({
      method: "POST",
      url: `/api/patients/${patientId}/messages`,
      headers: { cookie: other },
      payload: { body: "привет" },
    });

    expect(response.statusCode).toBe(403);
    await app.close();
  });
});
