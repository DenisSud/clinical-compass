import { describe, expect, it } from "vitest";
import { DOCTOR, PATIENT, newApp, signUpDoctor, signUpPatient } from "./test-support.js";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

type App = Awaited<ReturnType<typeof newApp>>;

async function codeOf(app: App, doctorCookie: string): Promise<string> {
  const response = await app.inject({ method: "GET", url: "/api/binding-code", headers: { cookie: doctorCookie } });
  expect(response.statusCode).toBe(200);
  return response.json<{ code: string }>().code;
}

function bind(app: App, patientCookie: string, code: string) {
  return app.inject({
    method: "POST",
    url: "/api/bind",
    headers: { cookie: patientCookie },
    payload: { code },
  });
}

describe("doctor's link code", () => {
  it("issues a six-character code without ambiguous symbols", async () => {
    const app = await newApp();
    const cookie = await signUpDoctor(app);

    const code = await codeOf(app, cookie);

    expect(code).toHaveLength(6);
    expect([...code].every((symbol) => ALPHABET.includes(symbol))).toBe(true);
    await app.close();
  });

  it("keeps returning the same code while it is valid", async () => {
    const app = await newApp();
    const cookie = await signUpDoctor(app);

    expect(await codeOf(app, cookie)).toBe(await codeOf(app, cookie));
    await app.close();
  });

  it("invalidates the previous code when rotated", async () => {
    const app = await newApp();
    const doctorCookie = await signUpDoctor(app);
    const patientCookie = await signUpPatient(app);
    const oldCode = await codeOf(app, doctorCookie);

    const rotated = await app.inject({
      method: "POST",
      url: "/api/binding-code/rotate",
      headers: { cookie: doctorCookie },
    });
    const newCode = rotated.json<{ code: string }>().code;

    expect(newCode).not.toBe(oldCode);
    expect((await bind(app, patientCookie, oldCode)).json()).toMatchObject({ code: "invalid_code" });
    await app.close();
  });

  it("is not readable by a patient", async () => {
    const app = await newApp();
    const cookie = await signUpPatient(app);

    const response = await app.inject({ method: "GET", url: "/api/binding-code", headers: { cookie } });

    expect(response.statusCode).toBe(403);
    await app.close();
  });
});

describe("patient binding", () => {
  it("links the patient to the doctor and shows up in the doctor's list", async () => {
    const app = await newApp();
    const doctorCookie = await signUpDoctor(app);
    const patientCookie = await signUpPatient(app);
    const code = await codeOf(app, doctorCookie);

    const bound = await bind(app, patientCookie, code);
    expect(bound.statusCode).toBe(200);

    const me = await app.inject({ method: "GET", url: "/api/me", headers: { cookie: patientCookie } });
    expect(me.json()).toMatchObject({
      role: "patient",
      profile: { doctor: { email: DOCTOR.email }, boundAt: expect.any(String) },
    });

    const list = await app.inject({ method: "GET", url: "/api/patients", headers: { cookie: doctorCookie } });
    expect(list.json()).toMatchObject({
      patients: [{ email: PATIENT.email, boundAt: expect.any(String) }],
    });
    await app.close();
  });

  it("accepts the code in any case and with surrounding spaces", async () => {
    const app = await newApp();
    const doctorCookie = await signUpDoctor(app);
    const patientCookie = await signUpPatient(app);
    const code = await codeOf(app, doctorCookie);

    const response = await bind(app, patientCookie, `  ${code.toLowerCase()}  `);

    expect(response.statusCode).toBe(200);
    await app.close();
  });

  it("rejects an unknown code", async () => {
    const app = await newApp();
    const patientCookie = await signUpPatient(app);

    const response = await bind(app, patientCookie, "ZZZZZZ");

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ code: "invalid_code" });
    await app.close();
  });

  it("rejects an expired code", async () => {
    const app = await newApp();
    const doctorCookie = await signUpDoctor(app);
    const patientCookie = await signUpPatient(app);
    const code = await codeOf(app, doctorCookie);
    app.conn.sqlite
      .prepare("UPDATE doctors SET binding_code_expires_at = ? WHERE email = ?")
      .run(new Date(Date.now() - 1000).toISOString(), DOCTOR.email);

    const response = await bind(app, patientCookie, code);

    expect(response.statusCode).toBe(410);
    expect(response.json()).toMatchObject({ code: "code_expired" });
    await app.close();
  });

  it("lets one code bind several patients", async () => {
    const app = await newApp();
    const doctorCookie = await signUpDoctor(app);
    const first = await signUpPatient(app);
    const second = await signUpPatient(app, { email: "second@example.com", password: "second good password" });
    const code = await codeOf(app, doctorCookie);

    expect((await bind(app, first, code)).statusCode).toBe(200);
    expect((await bind(app, second, code)).statusCode).toBe(200);

    const list = await app.inject({ method: "GET", url: "/api/patients", headers: { cookie: doctorCookie } });
    expect(list.json<{ patients: unknown[] }>().patients).toHaveLength(2);
    await app.close();
  });

  it("moves the patient to another doctor, and the first doctor loses sight of them", async () => {
    const app = await newApp();
    const firstDoctor = await signUpDoctor(app);
    const secondDoctor = await signUpDoctor(app, {
      email: "second-doctor@example.com",
      password: "another doctor password",
    });
    const patientCookie = await signUpPatient(app);

    await bind(app, patientCookie, await codeOf(app, firstDoctor));
    await bind(app, patientCookie, await codeOf(app, secondDoctor));

    const firstList = await app.inject({ method: "GET", url: "/api/patients", headers: { cookie: firstDoctor } });
    const secondList = await app.inject({ method: "GET", url: "/api/patients", headers: { cookie: secondDoctor } });

    expect(firstList.json()).toEqual({ patients: [] });
    expect(secondList.json<{ patients: unknown[] }>().patients).toHaveLength(1);
    await app.close();
  });
});
