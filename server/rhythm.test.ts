import { describe, expect, it } from "vitest";
import { newApp, signUpPatient, type App } from "./test-support.js";

function answers(value: number) {
  return Object.fromEntries(Array.from({ length: 9 }, (_, index) => [`q${index + 1}`, value]));
}

function submitAssessment(app: App, cookie: string, value = 1) {
  return app.inject({
    method: "POST",
    url: "/api/assessments/phq-9",
    headers: { cookie },
    payload: { submissionId: crypto.randomUUID(), answers: answers(value) },
  });
}

function submitDiary(app: App, cookie: string, payload: Record<string, unknown>) {
  return app.inject({
    method: "POST",
    url: "/api/diary",
    headers: { cookie },
    payload: { submissionId: crypto.randomUUID(), ...payload },
  });
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

describe("в дневнике одна запись в день", () => {
  it("отказывает во второй записи за тот же день", async () => {
    const app = await newApp();
    const cookie = await signUpPatient(app);

    const first = await submitDiary(app, cookie, { value: 6, entryDate: today() });
    const second = await submitDiary(app, cookie, { value: 8, entryDate: today() });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe("already_recorded");
    await app.close();
  });

  it("всё равно возвращает первую запись, когда ту же отправку повторяют", async () => {
    const app = await newApp();
    const cookie = await signUpPatient(app);
    const payload = { submissionId: "retry", value: 5, entryDate: today() };

    const first = await app.inject({ method: "POST", url: "/api/diary", headers: { cookie }, payload });
    const retry = await app.inject({ method: "POST", url: "/api/diary", headers: { cookie }, payload });

    expect(first.statusCode).toBe(201);
    expect(retry.statusCode).toBe(200);
    expect(retry.json().entry.id).toBe(first.json().entry.id);
    await app.close();
  });

  it("принимает вчера и отказывает в дате далеко от сегодня", async () => {
    const app = await newApp();
    const cookie = await signUpPatient(app);

    expect((await submitDiary(app, cookie, { value: 4, entryDate: daysAgo(1) })).statusCode).toBe(201);
    const far = await submitDiary(app, cookie, { value: 4, entryDate: daysAgo(30) });

    expect(far.statusCode).toBe(400);
    await app.close();
  });

  it("пропускает следующий день", async () => {
    const app = await newApp();
    const cookie = await signUpPatient(app);

    await submitDiary(app, cookie, { value: 4, entryDate: daysAgo(1) });
    const next = await submitDiary(app, cookie, { value: 7, entryDate: today() });

    expect(next.statusCode).toBe(201);
    await app.close();
  });
});

describe("опросник недельный", () => {
  it("отказывает во второй попытке в пределах недели", async () => {
    const app = await newApp();
    const cookie = await signUpPatient(app);

    const first = await submitAssessment(app, cookie);
    const second = await submitAssessment(app, cookie);

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe("too_soon");
    expect(second.json().message).toMatch(/Следующий раз/);
    await app.close();
  });

  it("не даёт отказу заблокировать повтор той же отправки", async () => {
    const app = await newApp();
    const cookie = await signUpPatient(app);
    const payload = { submissionId: "one", answers: answers(1) };

    await app.inject({ method: "POST", url: "/api/assessments/phq-9", headers: { cookie }, payload });
    const retry = await app.inject({
      method: "POST",
      url: "/api/assessments/phq-9",
      headers: { cookie },
      payload,
    });

    expect(retry.statusCode).toBe(200);
    await app.close();
  });

  it("открывается снова через семь дней", async () => {
    const app = await newApp();
    const cookie = await signUpPatient(app);
    await submitAssessment(app, cookie);

    app.conn.sqlite
      .prepare("UPDATE assessments SET submitted_at = ?")
      .run(new Date(Date.now() - 8 * 86_400_000).toISOString());

    expect((await submitAssessment(app, cookie, 2)).statusCode).toBe(201);
    await app.close();
  });

  it("возвращает историю ответов без обещания даты следующей попытки", async () => {
    const app = await newApp();
    const cookie = await signUpPatient(app);
    await submitAssessment(app, cookie);

    const response = await app.inject({ method: "GET", url: "/api/assessments", headers: { cookie } });

    // Дату следующей попытки пациент видит в списке шкал; история её не повторяет.
    expect(response.json().assessments).toHaveLength(1);
    expect(response.json()).not.toHaveProperty("nextAllowedAt");
    await app.close();
  });
});
