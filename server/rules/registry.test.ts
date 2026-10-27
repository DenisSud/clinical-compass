import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { PatientFacts } from "../../shared/contracts.js";
import type { Rule, RuleFacts, RulesResponse } from "../../shared/rules.js";
import { evaluateRule, InvalidRule, listRules, parseRule } from "./registry.js";
import { newApp, signUpDoctor, signUpPatient } from "../test-support.js";

const NO_FACTS: RuleFacts = {
  assessment: null,
  diary: null,
  adherence: null,
  patientFacts: null,
};

const NO_PATIENT_FACTS: PatientFacts = {
  epilepsyOrOrganicBrainDisease: null,
  maoInhibitors: null,
  egfrMlMin: null,
  childPugh: null,
  pregnancy: null,
  galactoseIntolerance: null,
};

function ruleById(id: string): Rule {
  const found = listRules().find((rule) => rule.id === id);
  if (!found) throw new Error(`правило ${id} не зарегистрировано`);
  return found;
}

/**
 * Факты одной отправки. Прошлая отправка по умолчанию — та же шкала и та же версия:
 * именно это и только это реестр имеет право сравнивать.
 */
function scaleFacts(input: {
  total: number;
  previous?: { instrumentId?: string; instrumentVersion?: string; total: number } | null;
  criticalItems?: string[];
}): NonNullable<RuleFacts["assessment"]> {
  const previous = input.previous ?? null;

  return {
    instrumentId: "phq-9",
    instrumentVersion: "1.0.0",
    instrumentTitle: "Опросник phq-9",
    total: input.total,
    previous:
      previous === null
        ? null
        : {
            instrumentId: previous.instrumentId ?? "phq-9",
            instrumentVersion: previous.instrumentVersion ?? "1.0.0",
            total: previous.total,
          },
    criticalItems: input.criticalItems ?? [],
  };
}

describe("файлы правил", () => {
  it("загружает минимальный набор правил, у каждого есть источник", () => {
    const rules = listRules();

    expect(rules.length).toBeGreaterThanOrEqual(3);
    for (const rule of rules) {
      expect(rule.source.ref.length, rule.id).toBeGreaterThan(0);
      expect(rule.when.length, rule.id).toBeGreaterThan(0);
    }
  });

  it("регистрирует каждый идентификатор один раз", () => {
    const ids = listRules().map((rule) => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("указывает каждой ссылкой на файл, который есть в корпусе", () => {
    for (const rule of listRules()) {
      const path = rule.source.ref.split("#")[0]!;
      expect(existsSync(join(process.cwd(), path)), `${rule.id}: ${rule.source.ref}`).toBe(true);
    }
  });

  it("отказывает в правиле без источника, а не регистрирует его", () => {
    const { source: _source, ...withoutSource } = ruleById("critical-item");

    expect(() => parseRule(withoutSource)).toThrow(InvalidRule);
  });

  it("отказывает в источнике с пустой ссылкой", () => {
    const rule = ruleById("critical-item");

    expect(() => parseRule({ ...rule, source: { ...rule.source, ref: "" } })).toThrow(InvalidRule);
  });

  it("отказывает в шаблоне, который называет значение, не даваемое условием", () => {
    const rule = ruleById("diary-sharp-drop");

    expect(() =>
      parseRule({ ...rule, output: { ...rule.output, detail: "Падение на {increase}." } }),
    ).toThrow(InvalidRule);
  });

  it("отказывает в имени шаблона, которое даёт только одно из условий", () => {
    // Условия соединены «или», поэтому сработать может любое: имя, которое даёт
    // только второе, — ошибка загрузки, а не 500 в момент срабатывания (issue #47).
    const partial = {
      id: "partial-template",
      title: "Частичный шаблон",
      when: [
        { fact: "diary.value", atMost: 3 },
        { fact: "diary.drop", atLeast: 3 },
      ],
      severity: "medium",
      output: { title: "Самочувствие {value}", detail: "Падение на {drop}." },
      source: {
        kind: "ours",
        ref: "docs/research/ai-decision-logic/sources-needed.md#13-что-значит-хорошо--нормально--плохо",
        status: "placeholder",
      },
    };

    let error: Error | null = null;
    try {
      parseRule(partial);
    } catch (caught) {
      error = caught as Error;
    }

    expect(error).toBeInstanceOf(InvalidRule);
    expect(error!.message).toContain("{drop}");
    expect(error!.message).toContain("diary.value");
    expect(error!.message).toContain("diary.drop");
  });
});

describe("выполнение одного правила", () => {
  it("срабатывает по правилу критического пункта и называет отмеченные пункты", () => {
    const match = evaluateRule(ruleById("critical-item"), {
      ...NO_FACTS,
      assessment: scaleFacts({ total: 12, criticalItems: ["q9"] }),
    });

    expect(match).not.toBeNull();
    expect(match!.detail).toContain("q9");
    expect(match!.severity).toBe("critical");
    expect(match!.source.kind).toBe("ours");
  });

  it("срабатывает по правилу ухудшения и печатает обе суммы", () => {
    const match = evaluateRule(ruleById("worsening"), {
      ...NO_FACTS,
      assessment: scaleFacts({ total: 18, previous: { total: 10 } }),
    });

    expect(match!.title).toBe("Ухудшение на 8 балла");
    expect(match!.detail).toContain("10");
    expect(match!.detail).toContain("18");
  });

  it("отказывается сравнивать две разные шкалы", () => {
    const rule = ruleById("worsening");

    // HADS-Т — тревога, HADS-Д — депрессия. Рост между ними — сравнение двух
    // вопросов, а не динамика пациента (decisions.md §4).
    expect(
      evaluateRule(rule, {
        ...NO_FACTS,
        assessment: scaleFacts({ total: 6, previous: { instrumentId: "hads-anxiety", total: 1 } }),
      }),
    ).toBeNull();
    expect(
      evaluateRule(rule, {
        ...NO_FACTS,
        assessment: {
          ...scaleFacts({ total: 3, previous: { instrumentId: "phq-9", total: 1 } }),
          instrumentId: "hads-depression",
        },
      }),
    ).toBeNull();
  });

  it("отказывается сравнивать ту же шкалу до и после смены версии", () => {
    const match = evaluateRule(ruleById("worsening"), {
      ...NO_FACTS,
      assessment: scaleFacts({ total: 18, previous: { instrumentVersion: "0.9.0", total: 10 } }),
    });

    expect(match).toBeNull();
  });

  it("не сравнивает, когда предыдущей отправки нет", () => {
    expect(
      evaluateRule(ruleById("worsening"), { ...NO_FACTS, assessment: scaleFacts({ total: 18 }) }),
    ).toBeNull();
  });

  it("срабатывает по правилу противопоказания при низкой СКФ", () => {
    const match = evaluateRule(ruleById("aviandr-contraindications"), {
      ...NO_FACTS,
      patientFacts: { ...NO_PATIENT_FACTS, egfrMlMin: 55 },
    });

    expect(match).not.toBeNull();
    expect(match!.detail).toContain("снижение СКФ");
    expect(match!.detail).toContain("55");
    expect(match!.source.kind).toBe("ohlp");
    expect(match!.source.status).toBe("confirmed");
  });

  it("называет каждое совпавшее противопоказание, а не только первое", () => {
    const match = evaluateRule(ruleById("aviandr-contraindications"), {
      ...NO_FACTS,
      patientFacts: { ...NO_PATIENT_FACTS, egfrMlMin: 45, pregnancy: "pregnant" },
    });

    expect(match!.detail).toContain("снижение СКФ");
    expect(match!.detail).toContain("беременность");
  });

  it("формулирует совпадение по одному условию ровно как до появления объединения", () => {
    const match = evaluateRule(ruleById("aviandr-contraindications"), {
      ...NO_FACTS,
      patientFacts: { ...NO_PATIENT_FACTS, pregnancy: "lactating" },
    });

    expect(match!.detail).toBe(
      "У пациента отмечено: грудное вскармливание. Раздел 4.3 ОХЛП относит это к противопоказаниям; назначение обсуждает врач.",
    );
  });

  it("не срабатывает по факту без ответа", () => {
    const rule = ruleById("aviandr-contraindications");

    expect(evaluateRule(rule, { ...NO_FACTS, patientFacts: NO_PATIENT_FACTS })).toBeNull();
    expect(evaluateRule(rule, NO_FACTS)).toBeNull();
  });

  it("не срабатывает ниже порога", () => {
    const rule = ruleById("worsening");

    const match = evaluateRule(rule, {
      ...NO_FACTS,
      assessment: scaleFacts({ total: 14, previous: { total: 10 } }),
    });

    expect(match).toBeNull();
  });

  it("даёт тот же ответ на двух прогонах по одним и тем же фактам", () => {
    const facts: RuleFacts = {
      ...NO_FACTS,
      assessment: scaleFacts({ total: 18, previous: { total: 10 } }),
      diary: { value: 2, previousValue: 6 },
      adherence: { consecutiveMissedDoses: 3 },
    };
    const rule = ruleById("worsening");

    expect(evaluateRule(rule, facts)).toEqual(evaluateRule(rule, facts));
    expect(listRules()).toEqual(listRules());
  });
});

describe("правила через API", () => {
  it("даёт врачу каждое правило с его источником", async () => {
    const app = await newApp();
    const doctorCookie = await signUpDoctor(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/rules",
      headers: { cookie: doctorCookie },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as RulesResponse;
    expect(body.rules).toHaveLength(listRules().length);
    expect(body.rules.every((rule) => rule.source.ref.length > 0)).toBe(true);
    await app.close();
  });

  it("держит список правил вне доступа пациента", async () => {
    const app = await newApp();
    const patientCookie = await signUpPatient(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/rules",
      headers: { cookie: patientCookie },
    });

    expect(response.statusCode).toBe(403);
    await app.close();
  });
});
