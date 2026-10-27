import { describe, expect, it } from "vitest";
import type { KnowledgeDocument } from "./knowledge/corpus.js";
import { recommendations, type RecommendationContext } from "./recommendations/service.js";
import { newApp, signUpDoctor, signUpPatient } from "./test-support.js";

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
});
