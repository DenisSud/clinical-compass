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

function createItem(app: App, cookie: string, patientId: string, title = "Сертралин 50 мг") {
  return app.inject({
    method: "POST",
    url: `/api/patients/${patientId}/plan`,
    headers: { cookie },
    payload: { kind: "medication", title, details: "Утром, после еды" },
  });
}

describe("the plan", () => {
  it("keeps a draft invisible to the patient until it is confirmed", async () => {
    const app = await newApp();
    const { doctorCookie, patientCookie, patientId } = await boundPair(app);

    const created = await createItem(app, doctorCookie, patientId);
    const before = await app.inject({ method: "GET", url: "/api/plan", headers: { cookie: patientCookie } });
    await app.inject({
      method: "POST",
      url: `/api/plan/${created.json().item.id}/confirm`,
      headers: { cookie: doctorCookie },
    });
    const after = await app.inject({ method: "GET", url: "/api/plan", headers: { cookie: patientCookie } });

    expect(created.statusCode).toBe(201);
    expect(created.json().item.status).toBe("draft");
    expect(before.json().items).toEqual([]);
    expect(after.json().items).toHaveLength(1);
    expect(after.json().items[0].title).toBe("Сертралин 50 мг");
    await app.close();
  });

  it("shows the doctor both drafts and confirmed items", async () => {
    const app = await newApp();
    const { doctorCookie, patientCookie, patientId } = await boundPair(app);
    const created = await createItem(app, doctorCookie, patientId);
    await createItem(app, doctorCookie, patientId, "КПТ, 1 раз в неделю");
    await app.inject({
      method: "POST",
      url: `/api/plan/${created.json().item.id}/confirm`,
      headers: { cookie: doctorCookie },
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/patients/${patientId}/plan`,
      headers: { cookie: doctorCookie },
    });

    const statuses = response.json().items.map((item: { status: string }) => item.status).sort();
    expect(statuses).toEqual(["active", "draft"]);
    await app.close();
  });

  it("refuses to confirm the same item twice", async () => {
    const app = await newApp();
    const { doctorCookie, patientId } = await boundPair(app);
    const created = await createItem(app, doctorCookie, patientId);
    const url = `/api/plan/${created.json().item.id}/confirm`;

    await app.inject({ method: "POST", url, headers: { cookie: doctorCookie } });
    const again = await app.inject({ method: "POST", url, headers: { cookie: doctorCookie } });

    expect(again.statusCode).toBe(409);
    await app.close();
  });

  it("hides an archived item from the patient", async () => {
    const app = await newApp();
    const { doctorCookie, patientCookie, patientId } = await boundPair(app);
    const created = await createItem(app, doctorCookie, patientId);
    const id = created.json().item.id;
    await app.inject({ method: "POST", url: `/api/plan/${id}/confirm`, headers: { cookie: doctorCookie } });
    await app.inject({ method: "POST", url: `/api/plan/${id}/archive`, headers: { cookie: doctorCookie } });

    const response = await app.inject({ method: "GET", url: "/api/plan", headers: { cookie: patientCookie } });

    expect(response.json().items).toEqual([]);
    await app.close();
  });

  it("keeps the patient from writing the plan", async () => {
    const app = await newApp();
    const { patientCookie, patientId } = await boundPair(app);

    const response = await createItem(app, patientCookie, patientId);

    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it("keeps another doctor out", async () => {
    const app = await newApp();
    const { doctorCookie, patientId } = await boundPair(app);
    const created = await createItem(app, doctorCookie, patientId);

    const stranger = await signUpDoctor(app, { email: "other@example.com", password: "other password" });
    const confirm = await app.inject({
      method: "POST",
      url: `/api/plan/${created.json().item.id}/confirm`,
      headers: { cookie: stranger },
    });
    const list = await app.inject({
      method: "GET",
      url: `/api/patients/${patientId}/plan`,
      headers: { cookie: stranger },
    });

    expect(confirm.statusCode).toBe(403);
    expect(list.statusCode).toBe(403);
    await app.close();
  });

  it("refuses an item without a title", async () => {
    const app = await newApp();
    const { doctorCookie, patientId } = await boundPair(app);

    const response = await app.inject({
      method: "POST",
      url: `/api/patients/${patientId}/plan`,
      headers: { cookie: doctorCookie },
      payload: { kind: "medication", title: "   " },
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });
});
