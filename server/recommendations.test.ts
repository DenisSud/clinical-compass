import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { KnowledgeDocument } from "./knowledge/corpus.js";
import { recommendations, type RecommendationContext } from "./recommendations/service.js";
import { bindPatient, newApp, signUpDoctor, signUpPatient, type App } from "./test-support.js";

const context: RecommendationContext = {
  band: { id: "moderate", label: "Умеренные проявления" },
  trend: "flat",
  activePlanTitles: ["Сертралин 50 мг"],
  draftPlanTitles: [],
  hasAssessment: true,
};

const smpc = (overrides: Partial<Extract<KnowledgeDocument, { kind: "smpc" }>> = {}): KnowledgeDocument => ({
  kind: "smpc",
  id: "sertraline-smpc",
  title: "Сертралин, ОХЛП",
  inn: "сертралин",
  tradeNames: ["Сертралин"],
  source: { publisher: "Реестр ЕАЭС", url: "https://lk.regmed.ru/x", retrievedAt: "2026-10-23" },
  sections: {
    indications: "Депрессивные эпизоды.",
    contraindications: "Несовместим с ИМАО.",
    dosing: "50 мг однократно утром.",
    interactions: "",
    warnings: "",
    adverseReactions: "",
  },
  ...overrides,
});

const guideline = (firstLine: string): KnowledgeDocument => ({
  kind: "guideline",
  id: "depression-kr",
  title: "КР: депрессивный эпизод",
  source: { publisher: "Минздрав", url: "https://cr.minzdrav.gov.ru/x", retrievedAt: "2026-10-23" },
  sections: { recommendations: "", firstLine, referral: "" },
});

describe("рекомендации без корпуса", () => {
  it("не возвращает карточек и точно говорит, чего не хватает", () => {
    const result = recommendations(context, []);

    expect(result.cards).toEqual([]);
    expect(result.missing).toContain("Нет ни одного текста ОХЛП — карточки препаратов не строятся");
    expect(result.missing).toContain("Нет клинических рекомендаций — основание «первая линия» нечем подтвердить");
  });

  it("называет пробел, когда у пациента нет опросника", () => {
    const result = recommendations({ ...context, hasAssessment: false }, []);

    expect(result.missing).toContain(
      "Пациент не проходил опросник — состояние и тяжесть неизвестны",
    );
  });
});

describe("рекомендации с корпусом", () => {
  it("строит карточку, основание которой взято из рекомендации, а не из догадки", () => {
    const result = recommendations(context, [smpc(), guideline("СИОЗС — препараты первой линии.")]);

    expect(result.cards).toHaveLength(1);
    expect(result.cards[0]?.basis).toBe("СИОЗС — препараты первой линии.");
    expect(result.cards[0]?.source?.url).toBe("https://lk.regmed.ru/x");
  });

  it("опирается на показания ОХЛП, когда клинической рекомендации нет", () => {
    const result = recommendations(context, [smpc()]);

    expect(result.cards[0]?.basis).toBe("Депрессивные эпизоды.");
    expect(result.missing).toContain("Нет клинических рекомендаций — основание «первая линия» нечем подтвердить");
  });

  it("отказывает в карточке, которой не на что опереться", () => {
    const bare = smpc({
      sections: {
        indications: "",
        contraindications: "",
        dosing: "",
        interactions: "",
        warnings: "",
        adverseReactions: "",
      },
    });

    const result = recommendations(context, [bare]);

    expect(result.cards).toEqual([]);
    expect(result.missing.some((line) => line.includes("основание отсутствует"))).toBe(true);
  });

  it("перечисляет пробелы внутри карточки, а не прячет их", () => {
    const thin = smpc({
      sections: {
        indications: "Депрессивные эпизоды.",
        contraindications: "",
        dosing: "",
        interactions: "",
        warnings: "",
        adverseReactions: "",
      },
    });

    const [card] = recommendations(context, [thin]).cards;

    expect(card?.missing).toContain("В ОХЛП не указаны противопоказания");
    expect(card?.missing).toContain(
      "Нет сведений о сопутствующих заболеваниях, функции почек и печени — противопоказания не проверены",
    );
    expect(card?.missing).toContain("В ОХЛП не указано дозирование");
  });

  it("предупреждает, что ухудшающемуся пациенту нужен разбор до смены терапии", () => {
    const [card] = recommendations({ ...context, trend: "worsening" }, [smpc()]).cards;

    expect(card?.missing).toContain("Состояние ухудшается — нужен разбор сигнала до смены терапии");
  });
});

/** Пациент у психиатра: в наборе HADS и UKU — две шкалы, суммы которых несравнимы. */
async function psychiatristPair(app: App) {
  const doctorCookie = await signUpDoctor(app, {
    email: "psychiatrist@example.com",
    password: "correct horse battery",
    specialty: "psychiatrist",
  });
  const patientCookie = await signUpPatient(app);
  await bindPatient(app, patientCookie, doctorCookie);
  const me = await app.inject({ method: "GET", url: "/api/me", headers: { cookie: patientCookie } });
  return { doctorCookie, patientCookie, patientId: me.json().profile.id as string };
}

function summedAnswers(id: string, value: number) {
  const uku = id === "uku";
  return Object.fromEntries(
    Array.from({ length: uku ? 48 : 7 }, (_, index) => [
      uku ? `u${String(index + 1).padStart(2, "0")}` : `a${index + 1}`,
      value,
    ]),
  );
}

/** Динамика и суммы живут в пробелах карточки: верхний `missing` говорит о корпусе и плане. */
function cardMissing(body: { cards: Array<{ missing: string[] }> }): string[] {
  return body.cards.flatMap((card) => card.missing);
}

async function submit(app: App, cookie: string, instrumentId: string, answers: Record<string, number>) {
  return app.inject({
    method: "POST",
    url: `/api/assessments/${instrumentId}`,
    headers: { cookie },
    payload: { submissionId: randomUUID(), answers },
  });
}

describe("маршрут рекомендаций", () => {
  it("строит карточку по сохранённому ОХЛП и называет, чего не хватает", async () => {
    const app = await newApp();
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

    const response = await app.inject({
      method: "GET",
      url: `/api/patients/${me.json().profile.id}/recommendations`,
      headers: { cookie: doctorCookie },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.cards).toHaveLength(1);
    expect(body.cards[0].title).toContain("АВИАНДР");
    expect(body.cards[0].basis.length).toBeGreaterThan(0);
    expect(body.missing).toContain(
      "Нет клинических рекомендаций — основание «первая линия» нечем подтвердить",
    );
    await app.close();
  });

  it("не пускает другого врача", async () => {
    const app = await newApp();
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
    const stranger = await signUpDoctor(app, { email: "other@example.com", password: "other password" });

    const response = await app.inject({
      method: "GET",
      url: `/api/patients/${me.json().profile.id}/recommendations`,
      headers: { cookie: stranger },
    });

    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it("берёт динамику по последней шкале с суммой, а не по сумме UKU", async () => {
    const app = await newApp();
    const { doctorCookie, patientCookie, patientId } = await psychiatristPair(app);

    await submit(app, patientCookie, "hads-anxiety", summedAnswers("hads-anxiety", 0));
    // UKU заполнена после HADS: 48 — сумма разных явлений, и вычитать её из HADS нельзя (SPEC S10).
    await submit(app, patientCookie, "uku", summedAnswers("uku", 1));

    const response = await app.inject({
      method: "GET",
      url: `/api/patients/${patientId}/recommendations`,
      headers: { cookie: doctorCookie },
    });

    // Динамика видна в том, что карточка говорит врачу о состоянии.
    expect(response.statusCode).toBe(200);
    expect(cardMissing(response.json())).not.toContain(
      "Состояние ухудшается — нужен разбор сигнала до смены терапии",
    );
    await app.close();
  });

  it("называет динамику неизвестной, когда есть только UKU", async () => {
    const app = await newApp();
    const { doctorCookie, patientCookie, patientId } = await psychiatristPair(app);

    await submit(app, patientCookie, "uku", summedAnswers("uku", 0));
    // Неделя прошла: иначе вторая отправка — отказ по периоду повтора.
    app.conn.sqlite
      .prepare("UPDATE assessments SET submitted_at = ?")
      .run(new Date(Date.now() - 8 * 86_400_000).toISOString());
    await submit(app, patientCookie, "uku", summedAnswers("uku", 1));

    const response = await app.inject({
      method: "GET",
      url: `/api/patients/${patientId}/recommendations`,
      headers: { cookie: doctorCookie },
    });
    const missing = cardMissing(response.json());

    expect(missing).toContain("Нет второй отправки шкалы с общей суммой — динамику оценить не на чем");
    expect(missing).not.toContain("Состояние ухудшается — нужен разбор сигнала до смены терапии");
    await app.close();
  });

  it("называет ухудшением две суммы HADS, а не отбрасывает их как несравнимые", async () => {
    const app = await newApp();
    const { doctorCookie, patientCookie, patientId } = await psychiatristPair(app);

    await submit(app, patientCookie, "hads-anxiety", summedAnswers("hads-anxiety", 0));
    // Неделя прошла: иначе вторая отправка — отказ по периоду повтора.
    app.conn.sqlite
      .prepare("UPDATE assessments SET submitted_at = ?")
      .run(new Date(Date.now() - 8 * 86_400_000).toISOString());
    // 7 пунктов по 3 — сумма 21 против 0: рост больше порога в 5 баллов.
    await submit(app, patientCookie, "hads-anxiety", summedAnswers("hads-anxiety", 3));

    const response = await app.inject({
      method: "GET",
      url: `/api/patients/${patientId}/recommendations`,
      headers: { cookie: doctorCookie },
    });
    const missing = cardMissing(response.json());

    expect(missing).toContain("Состояние ухудшается — нужен разбор сигнала до смены терапии");
    expect(missing).not.toContain("Нет второй отправки шкалы с общей суммой — динамику оценить не на чем");
    await app.close();
  });
});
