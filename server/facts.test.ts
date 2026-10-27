import { describe, expect, it } from "vitest";
import type { PatientFacts } from "../shared/contracts.js";
import { FACT_QUESTIONS, factAnswerText, factState } from "../shared/facts.js";
import { findRule } from "./rules/registry.js";
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

/** Inline inject like the rest of the suite: the helper's return type does not narrow. */
const putFacts = (app: App, cookie: string, payload: Record<string, unknown>) =>
  app.inject({ method: "PUT", url: "/api/facts", headers: { cookie }, payload }) as unknown as Promise<{
    statusCode: number;
    json: () => any;
  }>;

const listSignals = (app: App, cookie: string) =>
  app.inject({ method: "GET", url: "/api/signals", headers: { cookie } }) as unknown as Promise<{
    statusCode: number;
    json: () => any;
  }>;

describe("факты, блокирующие решение", () => {
  it("не спрашивали и «нет» — разные вещи: пустые факты остаются null", async () => {
    const app = await newApp();
    const { patientCookie } = await boundPair(app);

    const res = await app.inject({ method: "GET", url: "/api/facts", headers: { cookie: patientCookie } });

    expect(res.statusCode).toBe(200);
    expect(res.json().facts).toEqual({
      epilepsyOrOrganicBrainDisease: null,
      maoInhibitors: null,
      egfrMlMin: null,
      childPugh: null,
      pregnancy: null,
      galactoseIntolerance: null,
    });
    expect(res.json().unanswered).toHaveLength(6);
  });

  it("частичный ответ не затирает остальные поля", async () => {
    const app = await newApp();
    const { patientCookie } = await boundPair(app);

    await putFacts(app, patientCookie, { epilepsyOrOrganicBrainDisease: "no" });
    const res = await putFacts(app, patientCookie, { egfrMlMin: 78 });

    expect(res.statusCode).toBe(200);
    expect(res.json().facts.epilepsyOrOrganicBrainDisease).toBe("no");
    expect(res.json().facts.egfrMlMin).toBe(78);
    expect(res.json().facts.childPugh).toBeNull();
    expect(res.json().unanswered).not.toContain("epilepsyOrOrganicBrainDisease");
    expect(res.json().unanswered).not.toContain("egfrMlMin");
  });

  it("явный null возвращает вопрос в список незаданных", async () => {
    const app = await newApp();
    const { patientCookie } = await boundPair(app);

    await putFacts(app, patientCookie, { pregnancy: "no" });
    const res = await putFacts(app, patientCookie, { pregnancy: null });

    expect(res.json().facts.pregnancy).toBeNull();
    expect(res.json().unanswered).toContain("pregnancy");
  });

  it("приём МАО различает «сейчас» и «отменили меньше двух недель назад»", async () => {
    const app = await newApp();
    const { patientCookie } = await boundPair(app);

    const res = await putFacts(app, patientCookie, { maoInhibitors: "stopped_under_2_weeks" });

    expect(res.statusCode).toBe(200);
    expect(res.json().facts.maoInhibitors).toBe("stopped_under_2_weeks");
  });

  it("значение вне диапазона отклоняется", async () => {
    const app = await newApp();
    const { patientCookie } = await boundPair(app);

    const res = await putFacts(app, patientCookie, { egfrMlMin: 400 });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("validation_failed");
  });

  it("врач видит факты своего пациента", async () => {
    const app = await newApp();
    const { doctorCookie, patientCookie, patientId } = await boundPair(app);
    await putFacts(app, patientCookie, { childPugh: "B" });

    const res = await app.inject({
      method: "GET",
      url: `/api/patients/${patientId}/facts`,
      headers: { cookie: doctorCookie },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().facts.childPugh).toBe("B");
  });

  it("«нет» по Чайлд-Пью — ответ, а не отсутствие ответа", async () => {
    const app = await newApp();
    const { doctorCookie, patientCookie, patientId } = await boundPair(app);

    const put = await putFacts(app, patientCookie, { childPugh: "none" });
    expect(put.statusCode).toBe(200);

    const view = await app.inject({
      method: "GET",
      url: `/api/patients/${patientId}/facts`,
      headers: { cookie: doctorCookie },
    });
    expect(view.json().facts.childPugh).toBe("none");
    expect(view.json().unanswered).not.toContain("childPugh");

    // Правило перечисляет A, B и C: ответ «нет» не должен его включать.
    const signals = await app.inject({
      method: "GET",
      url: `/api/patients/${patientId}/signals`,
      headers: { cookie: doctorCookie },
    });
    const fired = signals.json().signals.filter(
      (signal: { ruleId: string | null }) => signal.ruleId === "aviandr-contraindications",
    );
    expect(fired).toHaveLength(0);
  });

  it("чужой врач получает отказ, а не пустой список", async () => {
    const app = await newApp();
    const { patientId } = await boundPair(app);
    const strangerCookie = await signUpDoctor(app, {
      email: "stranger@example.com",
      password: "a third long password",
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/patients/${patientId}/facts`,
      headers: { cookie: strangerCookie },
    });

    expect(res.statusCode).toBe(403);
  });

  it("врач не может писать факты: это ответы пациента о себе", async () => {
    const app = await newApp();
    const { doctorCookie } = await boundPair(app);

    const res = await putFacts(app, doctorCookie, { pregnancy: "no" });

    expect(res.statusCode).toBe(403);
  });
});

describe("СКФ с одним знаком после запятой (#52)", () => {
  it("59.6 сохраняется как есть и поднимает противопоказание", async () => {
    const app = await newApp();
    const { doctorCookie, patientCookie } = await boundPair(app);

    const res = await putFacts(app, patientCookie, { egfrMlMin: 59.6 });

    expect(res.statusCode).toBe(200);
    expect(res.json().facts.egfrMlMin).toBe(59.6);

    const { signals } = (await listSignals(app, doctorCookie)).json();
    expect(signals).toHaveLength(1);
    expect(signals[0].detail).toContain("59.6");
    expect(signals[0].detail).toContain("порог 60");
    await app.close();
  });

  it("60 карточку не поднимает: порог правила строго ниже 60", async () => {
    const app = await newApp();
    const { doctorCookie, patientCookie } = await boundPair(app);

    const res = await putFacts(app, patientCookie, { egfrMlMin: 60 });

    expect(res.statusCode).toBe(200);
    expect(res.json().facts.egfrMlMin).toBe(60);
    expect((await listSignals(app, doctorCookie)).json().signals).toEqual([]);
    await app.close();
  });

  it("59.95 отклоняется с сообщением про знак после запятой, а не округляется", async () => {
    const app = await newApp();
    const { patientCookie } = await boundPair(app);

    const res = await putFacts(app, patientCookie, { egfrMlMin: 59.95 });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("validation_failed");
    expect(res.json().message).toContain("СКФ");
    expect(res.json().message).toContain("знака после запятой");

    const after = await app.inject({
      method: "GET",
      url: "/api/facts",
      headers: { cookie: patientCookie },
    });
    expect(after.json().facts.egfrMlMin).toBeNull();
    await app.close();
  });
});

describe("PUT /api/facts не подписывает пустоту ответом (#53)", () => {
  const factRows = (app: App): number =>
    (app.conn.sqlite.prepare("SELECT COUNT(*) AS count FROM patient_facts").get() as { count: number })
      .count;

  it("пустое тело не ставит дату ответа и не заводит строку", async () => {
    const app = await newApp();
    const { doctorCookie, patientCookie, patientId } = await boundPair(app);

    const res = await putFacts(app, patientCookie, {});

    expect(res.statusCode).toBe(200);
    expect(res.json().answeredAt).toBeNull();
    expect(res.json().unanswered).toHaveLength(6);
    expect(factRows(app)).toBe(0);

    const theirs = await app.inject({
      method: "GET",
      url: `/api/patients/${patientId}/facts`,
      headers: { cookie: doctorCookie },
    });
    expect(theirs.json().answeredAt).toBeNull();
    await app.close();
  });

  it("пустое тело после ответа не сдвигает дату ответа", async () => {
    const app = await newApp();
    const { patientCookie } = await boundPair(app);
    await putFacts(app, patientCookie, { pregnancy: "no" });

    // Дата из прошлого: если бы пустой PUT её переписал, тест не зависел бы от часов.
    app.conn.sqlite
      .prepare("UPDATE patient_facts SET updated_at = '2020-01-01T00:00:00Z'")
      .run();

    const again = await putFacts(app, patientCookie, {});

    expect(again.json().answeredAt).toBe("2020-01-01T00:00:00Z");
    await app.close();
  });

  it("опечатка в имени поля — отказ с этим именем, а не 200 с тихой потерей", async () => {
    const app = await newApp();
    const { patientCookie } = await boundPair(app);

    const res = await putFacts(app, patientCookie, { childPughGrade: "B" });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("validation_failed");
    expect(res.json().message).toContain("childPughGrade");

    const after = await app.inject({
      method: "GET",
      url: "/api/facts",
      headers: { cookie: patientCookie },
    });
    expect(after.json().unanswered).toHaveLength(6);
    await app.close();
  });

  it("опечатка рядом с верным полем не сохраняет верное", async () => {
    const app = await newApp();
    const { patientCookie } = await boundPair(app);

    const res = await putFacts(app, patientCookie, { pregnancy: "no", childPughGrade: "B" });

    expect(res.statusCode).toBe(400);
    const after = await app.inject({
      method: "GET",
      url: "/api/facts",
      headers: { cookie: patientCookie },
    });
    expect(after.json().facts.pregnancy).toBeNull();
    expect(after.json().answeredAt).toBeNull();
    await app.close();
  });
});

describe("сохранённое противопоказание доходит до врача", () => {
  it("СКФ 45 поднимает критический сигнал по правилу ОХЛП", async () => {
    const app = await newApp();
    const { doctorCookie, patientCookie } = await boundPair(app);

    await putFacts(app, patientCookie, { egfrMlMin: 45 });

    const { signals } = (await listSignals(app, doctorCookie)).json();
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({
      kind: "contraindication",
      severity: "critical",
      ruleId: "aviandr-contraindications",
      ruleTitle: "Противопоказания к «Авиандру»",
      status: "saved",
    });
    expect(signals[0].ruleSource).toMatchObject({ kind: "ohlp", status: "confirmed" });
    expect(signals[0].detail).toContain("снижение СКФ");
    await app.close();
  });

  it("карточка называет оба противопоказания, а не первое", async () => {
    const app = await newApp();
    const { doctorCookie, patientCookie } = await boundPair(app);

    await putFacts(app, patientCookie, { egfrMlMin: 45, pregnancy: "pregnant" });

    const { signals } = (await listSignals(app, doctorCookie)).json();
    expect(signals).toHaveLength(1);
    expect(signals[0].detail).toContain("снижение СКФ");
    expect(signals[0].detail).toContain("беременность");
    await app.close();
  });

  it("повторная запись тех же фактов не плодит дублей", async () => {
    const app = await newApp();
    const { doctorCookie, patientCookie } = await boundPair(app);

    await putFacts(app, patientCookie, { egfrMlMin: 45 });
    const again = await putFacts(app, patientCookie, { egfrMlMin: 45 });

    expect(again.statusCode).toBe(200);
    expect((await listSignals(app, doctorCookie)).json().signals).toHaveLength(1);
    await app.close();
  });

  it("«нет» и «не спрашивали» сигнала не создают", async () => {
    const app = await newApp();
    const { doctorCookie, patientCookie } = await boundPair(app);

    await putFacts(app, patientCookie, {
      epilepsyOrOrganicBrainDisease: "no",
      maoInhibitors: "none",
      egfrMlMin: 90,
      childPugh: null,
      pregnancy: "no",
      galactoseIntolerance: "no",
    });

    expect((await listSignals(app, doctorCookie)).json().signals).toEqual([]);
    await app.close();
  });

  it("отмена противопоказания не закрывает уже поднятый сигнал", async () => {
    const app = await newApp();
    const { doctorCookie, patientCookie } = await boundPair(app);

    await putFacts(app, patientCookie, { pregnancy: "pregnant" });
    await putFacts(app, patientCookie, { pregnancy: null });

    const { signals } = (await listSignals(app, doctorCookie)).json();
    expect(signals).toHaveLength(1);
    expect(signals[0].status).toBe("saved");
    await app.close();
  });

  it("второе противопоказание не прячется за первой карточкой", async () => {
    const app = await newApp();
    const { doctorCookie, patientCookie } = await boundPair(app);

    await putFacts(app, patientCookie, { pregnancy: "pregnant" });
    await putFacts(app, patientCookie, { egfrMlMin: 45 });

    const { signals } = (await listSignals(app, doctorCookie)).json();
    const details = (signals as { detail: string }[]).map((signal) => signal.detail);

    // Врачу нужна карточка, где названы оба: прежняя карточка только про беременность
    // может остаться открытой, закрывать её врачу.
    expect(details.some((detail) => detail.includes("45") && detail.includes("беременность"))).toBe(
      true,
    );
    await app.close();
  });

  it("пациент сигналов не видит и после своих ответов", async () => {
    const app = await newApp();
    const { patientCookie } = await boundPair(app);

    await putFacts(app, patientCookie, { egfrMlMin: 45 });

    expect((await listSignals(app, patientCookie)).statusCode).toBe(403);
    await app.close();
  });
});

describe("экран фактов читает те же данные, что и правило", () => {
  const NOTHING_ANSWERED: PatientFacts = {
    epilepsyOrOrganicBrainDisease: null,
    maoInhibitors: null,
    egfrMlMin: null,
    childPugh: null,
    pregnancy: null,
    galactoseIntolerance: null,
  };

  const factsWith = (key: keyof PatientFacts, value: unknown): PatientFacts =>
    ({ ...NOTHING_ANSWERED, [key]: value }) as PatientFacts;

  it("дата ответа видна и пациенту, и врачу; до ответов её нет", async () => {
    const app = await newApp();
    const { doctorCookie, patientCookie, patientId } = await boundPair(app);

    const before = await app.inject({ method: "GET", url: "/api/facts", headers: { cookie: patientCookie } });
    expect(before.json().answeredAt).toBeNull();

    await putFacts(app, patientCookie, { galactoseIntolerance: "no" });

    const mine = await app.inject({ method: "GET", url: "/api/facts", headers: { cookie: patientCookie } });
    const theirs = await app.inject({
      method: "GET",
      url: `/api/patients/${patientId}/facts`,
      headers: { cookie: doctorCookie },
    });

    // Источник ответа — пациент и дата; это одна дата на всю строку ответов, а не на вопрос.
    expect(Number.isNaN(Date.parse(mine.json().answeredAt))).toBe(false);
    expect(theirs.json().answeredAt).toBe(mine.json().answeredAt);
    await app.close();
  });

  it("каждый ответ, на котором срабатывает правило, в анкете есть и помечен как отмеченный", () => {
    const rule = findRule("aviandr-contraindications");
    expect(rule).toBeDefined();

    for (const condition of rule?.when ?? []) {
      if ("below" in condition) {
        const key = condition.fact.replace("patientFact.", "") as keyof PatientFacts;
        const question = FACT_QUESTIONS.find((candidate) => candidate.key === key);
        expect(question?.kind).toBe("number");
        expect(factState(key, factsWith(key, condition.below - 1))).toBe("marked");
        continue;
      }

      if (!("is" in condition)) continue;

      const key = condition.fact.replace("patientFact.", "") as keyof PatientFacts;
      const question = FACT_QUESTIONS.find((candidate) => candidate.key === key);
      // Вариант, который читает правило, обязан быть среди ответов, и это «отмечено»,
      // а не «не отмечено»: иначе пациент ответил бы «да», а экран показал бы «нет».
      const answer =
        question?.kind === "choice"
          ? question.answers.find((option) => option.value === condition.is)
          : undefined;

      expect(answer, `варианта ${condition.is} нет в вопросе про ${condition.fact}`).toBeDefined();
      expect(answer?.state).toBe("marked");
      expect(factAnswerText(key, factsWith(key, condition.is))).toBe(answer?.label);
    }
  });
});
