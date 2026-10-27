import { describe, expect, it } from "vitest";
import { bindPatient, newApp, signUpDoctor, signUpPatient, type App } from "./test-support.js";

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

describe("что поднимает сигнал", () => {
  it("поднимает критический сигнал по пункту 9", async () => {
    const app = await newApp();
    const { doctorCookie, patientCookie } = await boundPair(app);
    await submit(app, patientCookie, 0, { q9: 1 });

    const signals = listSignals(app, doctorCookie).then((response) => response.json().signals);

    expect((await signals).map((signal: { kind: string }) => signal.kind)).toContain("critical_item");
    expect((await signals)[0].severity).toBe("critical");
    await app.close();
  });

  it("ничего не поднимает при низкой сумме без критического ответа", async () => {
    const app = await newApp();
    const { doctorCookie, patientCookie } = await boundPair(app);
    await submit(app, patientCookie, 0);

    expect((await listSignals(app, doctorCookie)).json().signals).toEqual([]);
    await app.close();
  });

  it("поднимает высокий сигнал при тяжёлой сумме", async () => {
    const app = await newApp();
    const { doctorCookie, patientCookie } = await boundPair(app);
    await submit(app, patientCookie, 2);

    const kinds = (await listSignals(app, doctorCookie)).json().signals.map((s: { kind: string }) => s.kind);
    expect(kinds).toContain("severe_total");
    await app.close();
  });

  it("поднимает сигнал об ухудшении только когда есть с чем сравнить", async () => {
    const app = await newApp();
    const { doctorCookie, patientCookie } = await boundPair(app);
    await submit(app, patientCookie, 0);
    expect((await listSignals(app, doctorCookie)).json().signals).toEqual([]);

    // опросник недельный, поэтому первая отправка должна «состариться» до второй
    app.conn.sqlite
      .prepare("UPDATE assessments SET submitted_at = ?")
      .run(new Date(Date.now() - 8 * 86_400_000).toISOString());

    await submit(app, patientCookie, 1, { q2: 2, q3: 2 });
    const kinds = (await listSignals(app, doctorCookie)).json().signals.map((s: { kind: string }) => s.kind);
    expect(kinds).toContain("worsening");
    await app.close();
  });

  it("называет шкалу и обе суммы, когда говорит об ухудшении", async () => {
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

  it("не сравнивает один опросник с другим", async () => {
    const app = await newApp();
    const { patientCookie } = await boundPair(app);

    // PHQ-9 на входе: шесть баллов. В терапии следом HADS-тревога: один балл.
    // Числа рядом, но шкалы разные — сравнение выдало бы «ухудшение на 5»
    // у пациента, состояние которого не изменилось.
    await submit(app, patientCookie, 0, { q1: 3, q2: 3 });
    const psychiatristCookie = await signUpDoctor(app, {
      email: "psychiatrist@example.com",
      password: "correct horse battery",
      specialty: "psychiatrist",
    });
    await bindPatient(app, patientCookie, psychiatristCookie);
    const hads = await app.inject({
      method: "POST",
      url: "/api/assessments/hads-anxiety",
      headers: { cookie: patientCookie },
      payload: {
        submissionId: crypto.randomUUID(),
        answers: { a1: 1, a2: 0, a3: 0, a4: 0, a5: 0, a6: 0, a7: 0 },
      },
    });
    expect(hads.statusCode).toBe(201);

    const kinds = (await listSignals(app, psychiatristCookie))
      .json()
      .signals.map((s: { kind: string }) => s.kind);
    expect(kinds).not.toContain("worsening");
    await app.close();
  });

  it("поднимает сигнал при очень низкой оценке дневника", async () => {
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

  it("не дублирует сигнал, когда ту же отправку повторяют", async () => {
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

describe("жизненный путь сигнала", () => {
  it("переводит saved в in_review и отказывает во втором взятии", async () => {
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

  it("не закрывает сигнал только потому, что его прочитали", async () => {
    const app = await newApp();
    const { doctorCookie, patientCookie } = await boundPair(app);
    await submit(app, patientCookie, 3);

    await listSignals(app, doctorCookie);
    await listSignals(app, doctorCookie);

    expect((await listSignals(app, doctorCookie)).json().signals[0].status).toBe("saved");
    await app.close();
  });

  it("отказывает в закрытии без исхода", async () => {
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

  it("закрывает с исходом и сохраняет его", async () => {
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

  it("не пускает другого врача к сигналу", async () => {
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

  it("не пускает пациента на маршруты сигналов", async () => {
    const app = await newApp();
    const { patientCookie } = await boundPair(app);

    expect((await listSignals(app, patientCookie)).statusCode).toBe(403);
    await app.close();
  });
});

describe("у UKU нет суммы, поэтому её полоса не поднимает карточку", () => {
  it("сохраняет ответы и не добавляет сигнал по общей сумме", async () => {
    const app = await newApp();
    const { patientCookie } = await boundPair(app);
    const psychiatristCookie = await signUpDoctor(app, {
      email: "psychiatrist@example.com",
      password: "correct horse battery",
      specialty: "psychiatrist",
    });
    await bindPatient(app, patientCookie, psychiatristCookie);

    const submitted = await app.inject({
      method: "POST",
      url: "/api/assessments/uku",
      headers: { cookie: patientCookie },
      payload: {
        submissionId: crypto.randomUUID(),
        answers: Object.fromEntries(
          Array.from({ length: 48 }, (_, index) => [`u${String(index + 1).padStart(2, "0")}`, 1]),
        ),
      },
    });
    expect(submitted.statusCode).toBe(201);

    const signals = await app.inject({
      method: "GET",
      url: "/api/signals",
      headers: { cookie: psychiatristCookie },
    });
    const kinds = (signals.json().signals as Array<{ kind: string }>).map((signal) => signal.kind);

    // Общей суммы у шкалы нет (Q52): «сумма 48» была бы числом из разных явлений,
    // а такое число запрещено складывать (SPEC S10).
    expect(kinds).not.toContain("severe_total");
    await app.close();
  });
});

describe("карточка говорит, какое правило сработало", () => {
  it("называет врачу правило и его источник-заглушку", async () => {
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

  it("указывает в карточке дневника на правило, которое её подняло", async () => {
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

describe("сигнал называет опросник, из которого пришёл", () => {
  it("говорит, у какого инструмента критический пункт, а не просто что он есть", async () => {
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

    // Врач читает карточку, а не идентификатор правила: без названия ему остаётся гадать,
    // какую форму заполнил пациент.
    expect(critical?.detail).toContain("PHQ-9");
    await app.close();
  });
});
