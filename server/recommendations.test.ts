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

describe("recommendations without a corpus", () => {
  it("returns no cards and says exactly what is missing", () => {
    const result = recommendations(context, []);

    expect(result.cards).toEqual([]);
    expect(result.missing).toContain("Нет ни одного текста ОХЛП — карточки препаратов не строятся");
    expect(result.missing).toContain("Нет клинических рекомендаций — основание «первая линия» нечем подтвердить");
  });

  it("names the gap when the patient has no questionnaire", () => {
    const result = recommendations({ ...context, hasAssessment: false }, []);

    expect(result.missing).toContain(
      "Пациент не проходил опросник — состояние и тяжесть неизвестны",
    );
  });
});

describe("recommendations with a corpus", () => {
  it("builds a card whose basis comes from the guideline, not from a guess", () => {
    const result = recommendations(context, [smpc(), guideline("СИОЗС — препараты первой линии.")]);

    expect(result.cards).toHaveLength(1);
    expect(result.cards[0]?.basis).toBe("СИОЗС — препараты первой линии.");
    expect(result.cards[0]?.source?.url).toBe("https://lk.regmed.ru/x");
  });

  it("falls back to the indications in the ОХЛП when there is no guideline", () => {
    const result = recommendations(context, [smpc()]);

    expect(result.cards[0]?.basis).toBe("Депрессивные эпизоды.");
    expect(result.missing).toContain("Нет клинических рекомендаций — основание «первая линия» нечем подтвердить");
  });

  it("refuses a card that has nothing to stand on", () => {
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

  it("lists the gaps inside a card instead of hiding them", () => {
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

  it("warns that a worsening patient needs a review before a therapy change", () => {
    const [card] = recommendations({ ...context, trend: "worsening" }, [smpc()]).cards;

    expect(card?.missing).toContain("Состояние ухудшается — нужен разбор сигнала до смены терапии");
  });
});

describe("the recommendations route", () => {
  it("builds a card from the shipped ОХЛП and names what is still missing", async () => {
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

  it("keeps another doctor out", async () => {
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
