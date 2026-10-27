import { describe, expect, it } from "vitest";
import { DOCTOR, PATIENT, cookieOf, newApp, signUpDoctor, signUpPatient } from "./test-support.js";

describe("patient signup and signin", () => {
  it("creates a patient, starts a session and returns the patient role", async () => {
    const app = await newApp();

    const cookie = await signUpPatient(app);
    const me = await app.inject({ method: "GET", url: "/api/me", headers: { cookie } });

    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({
      role: "patient",
      profile: { email: PATIENT.email, doctor: null, boundAt: null },
    });
    await app.close();
  });

  it("refuses a second account on the same email", async () => {
    const app = await newApp();
    await signUpPatient(app);

    const second = await app.inject({
      method: "POST",
      url: "/api/auth/patient/signup",
      payload: { ...PATIENT, password: "a different password" },
    });

    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({ code: "email_taken" });
    await app.close();
  });

  it("refuses a wrong password", async () => {
    const app = await newApp();
    await signUpPatient(app);

    const attempt = await app.inject({
      method: "POST",
      url: "/api/auth/patient/signin",
      payload: { ...PATIENT, password: "not the password" },
    });

    expect(attempt.statusCode).toBe(401);
    expect(attempt.json()).toMatchObject({ code: "invalid_credentials" });
    await app.close();
  });

  it("signs an existing patient in and returns the patient role", async () => {
    const app = await newApp();
    await signUpPatient(app);

    const signin = await app.inject({
      method: "POST",
      url: "/api/auth/patient/signin",
      payload: PATIENT,
    });

    expect(signin.statusCode).toBe(200);
    expect(signin.json()).toMatchObject({ role: "patient" });
    await app.close();
  });
});

describe("doctor signup and signin", () => {
  it("creates a doctor and returns the doctor role", async () => {
    const app = await newApp();

    const cookie = await signUpDoctor(app);
    const me = await app.inject({ method: "GET", url: "/api/me", headers: { cookie } });

    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ role: "doctor", profile: { email: DOCTOR.email } });
    await app.close();
  });

  it("reads the specialty into the doctor's profile: therapist by default", async () => {
    const app = await newApp();

    const cookie = await signUpDoctor(app);
    const me = await app.inject({ method: "GET", url: "/api/me", headers: { cookie } });

    // Скрининг — точка входа: старое тело без поля читается как терапевт (Q49).
    expect(me.json().profile.specialty).toBe("therapist");
    await app.close();
  });

  it("keeps the specialty the doctor chose at signup", async () => {
    const app = await newApp();

    const cookie = await signUpDoctor(app, {
      email: "psychiatrist@example.com",
      password: "correct horse battery",
      specialty: "psychiatrist",
    });
    const signin = await app.inject({
      method: "POST",
      url: "/api/auth/doctor/signin",
      payload: { email: "psychiatrist@example.com", password: "correct horse battery" },
    });
    const me = await app.inject({ method: "GET", url: "/api/me", headers: { cookie } });

    expect(me.json().profile.specialty).toBe("psychiatrist");
    expect(signin.json().profile.specialty).toBe("psychiatrist");
    await app.close();
  });

  it("reads an unknown specialty as therapist instead of inventing a third one", async () => {
    const app = await newApp();

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/doctor/signup",
      payload: { ...DOCTOR, specialty: "surgeon" },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().profile.specialty).toBe("therapist");
    await app.close();
  });
});

describe("session", () => {
  it("rejects a request without a cookie", async () => {
    const app = await newApp();

    const me = await app.inject({ method: "GET", url: "/api/me" });

    expect(me.statusCode).toBe(401);
    expect(me.json()).toMatchObject({ code: "unauthorized" });
    await app.close();
  });

  it("stores a httpOnly lax cookie that lasts a week", async () => {
    const app = await newApp();

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/patient/signup",
      payload: PATIENT,
    });

    const header = response.headers["set-cookie"];
    const raw = Array.isArray(header) ? header.join(";") : String(header);
    expect(raw).toMatch(/HttpOnly/i);
    expect(raw).toMatch(/SameSite=Lax/i);
    expect(raw).toMatch(/Max-Age=604800/);
    await app.close();
  });

  it("keeps only a hash of the token in the database", async () => {
    const app = await newApp();
    const cookie = await signUpPatient(app);
    const token = cookie.split("=")[1] ?? "";

    const rows = app.conn.sqlite.prepare("SELECT token_hash FROM sessions").all() as {
      token_hash: string;
    }[];

    expect(rows).toHaveLength(1);
    expect(rows[0]?.token_hash).not.toBe(token);
    expect(rows[0]?.token_hash).toMatch(/^[0-9a-f]{64}$/);
    await app.close();
  });

  it("re-issues the cookie when the session slides, so an active browser keeps it", async () => {
    const app = await newApp();
    const cookie = await signUpPatient(app);
    app.conn.sqlite
      .prepare("UPDATE sessions SET expires_at = ?")
      .run(new Date(Date.now() + 60 * 60 * 1000).toISOString());

    const me = await app.inject({ method: "GET", url: "/api/me", headers: { cookie } });

    expect(me.statusCode).toBe(200);
    expect(String(me.headers["set-cookie"])).toMatch(/Max-Age=604800/);
    const row = app.conn.sqlite.prepare("SELECT expires_at FROM sessions").get() as { expires_at: string };
    expect(new Date(row.expires_at).getTime()).toBeGreaterThan(Date.now() + 6 * 24 * 60 * 60 * 1000);
    await app.close();
  });

  it("invalidates the session on signout", async () => {
    const app = await newApp();
    const cookie = await signUpPatient(app);

    const signout = await app.inject({
      method: "POST",
      url: "/api/auth/signout",
      headers: { cookie },
    });
    expect(signout.statusCode).toBe(204);

    const me = await app.inject({ method: "GET", url: "/api/me", headers: { cookie } });
    expect(me.statusCode).toBe(401);
    await app.close();
  });
});

describe("role isolation", () => {
  it("stops a patient from reading the doctor's patient list", async () => {
    const app = await newApp();
    const cookie = await signUpPatient(app);

    const list = await app.inject({ method: "GET", url: "/api/patients", headers: { cookie } });

    expect(list.statusCode).toBe(403);
    expect(list.json()).toMatchObject({ code: "forbidden" });
    await app.close();
  });

  it("gives a doctor an empty list before anyone is bound", async () => {
    const app = await newApp();
    const cookie = await signUpDoctor(app);

    const list = await app.inject({ method: "GET", url: "/api/patients", headers: { cookie } });

    expect(list.statusCode).toBe(200);
    expect(list.json()).toEqual({ patients: [] });
    await app.close();
  });
});

describe("роль решает, кто входит", () => {
  it("не пускает врача в пациентский аккаунт и не подтверждает, что аккаунт есть", async () => {
    const app = await newApp();
    await signUpPatient(app);

    const wrongDoor = await app.inject({
      method: "POST",
      url: "/api/auth/doctor/signin",
      payload: PATIENT,
    });
    const unknownEmail = await app.inject({
      method: "POST",
      url: "/api/auth/doctor/signin",
      payload: { ...PATIENT, email: "nobody@example.com" },
    });

    expect(wrongDoor.statusCode).toBe(401);
    expect(wrongDoor.json()).toMatchObject({ code: "invalid_credentials" });
    expect(wrongDoor.json()).toEqual(unknownEmail.json());
    await app.close();
  });

  it("не пускает пациента в аккаунт врача", async () => {
    const app = await newApp();
    await signUpDoctor(app);

    const wrongDoor = await app.inject({
      method: "POST",
      url: "/api/auth/patient/signin",
      payload: DOCTOR,
    });

    expect(wrongDoor.statusCode).toBe(401);
    expect(wrongDoor.json()).toMatchObject({ code: "invalid_credentials" });
    await app.close();
  });
});
