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

describe("rule files", () => {
  it("loads a minimal set of rules, each with a source", () => {
    const rules = listRules();

    expect(rules.length).toBeGreaterThanOrEqual(3);
    for (const rule of rules) {
      expect(rule.source.ref.length, rule.id).toBeGreaterThan(0);
      expect(rule.when.length, rule.id).toBeGreaterThan(0);
    }
  });

  it("registers every id once", () => {
    const ids = listRules().map((rule) => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("points every reference at a file that exists in the corpus", () => {
    for (const rule of listRules()) {
      const path = rule.source.ref.split("#")[0]!;
      expect(existsSync(join(process.cwd(), path)), `${rule.id}: ${rule.source.ref}`).toBe(true);
    }
  });

  it("refuses a rule without a source instead of registering it", () => {
    const { source: _source, ...withoutSource } = ruleById("critical-item");

    expect(() => parseRule(withoutSource)).toThrow(InvalidRule);
  });

  it("refuses a source with an empty reference", () => {
    const rule = ruleById("critical-item");

    expect(() => parseRule({ ...rule, source: { ...rule.source, ref: "" } })).toThrow(InvalidRule);
  });

  it("refuses a template that names a value the condition does not produce", () => {
    const rule = ruleById("diary-sharp-drop");

    expect(() =>
      parseRule({ ...rule, output: { ...rule.output, detail: "Падение на {increase}." } }),
    ).toThrow(InvalidRule);
  });
});

describe("executing one rule", () => {
  it("fires the critical-item rule and names the flagged items", () => {
    const match = evaluateRule(ruleById("critical-item"), {
      ...NO_FACTS,
      assessment: { instrumentId: "phq-9", instrumentTitle: "Опросник phq-9", total: 12, previousTotal: null, criticalItems: ["q9"] },
    });

    expect(match).not.toBeNull();
    expect(match!.detail).toContain("q9");
    expect(match!.severity).toBe("critical");
    expect(match!.source.kind).toBe("ours");
  });

  it("fires the worsening rule and prints both totals", () => {
    const match = evaluateRule(ruleById("worsening"), {
      ...NO_FACTS,
      assessment: { instrumentId: "phq-9", instrumentTitle: "Опросник phq-9", total: 18, previousTotal: 10, criticalItems: [] },
    });

    expect(match!.title).toBe("Ухудшение на 8 балла");
    expect(match!.detail).toContain("10");
    expect(match!.detail).toContain("18");
  });

  it("fires the contraindication rule on a low eGFR", () => {
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

  it("names every matched contraindication, not only the first", () => {
    const match = evaluateRule(ruleById("aviandr-contraindications"), {
      ...NO_FACTS,
      patientFacts: { ...NO_PATIENT_FACTS, egfrMlMin: 45, pregnancy: "pregnant" },
    });

    expect(match!.detail).toContain("снижение СКФ");
    expect(match!.detail).toContain("беременность");
  });

  it("words a one-condition match exactly as before joining was added", () => {
    const match = evaluateRule(ruleById("aviandr-contraindications"), {
      ...NO_FACTS,
      patientFacts: { ...NO_PATIENT_FACTS, pregnancy: "lactating" },
    });

    expect(match!.detail).toBe(
      "У пациента отмечено: грудное вскармливание. Раздел 4.3 ОХЛП относит это к противопоказаниям; назначение обсуждает врач.",
    );
  });

  it("does not fire on an unanswered fact", () => {
    const rule = ruleById("aviandr-contraindications");

    expect(evaluateRule(rule, { ...NO_FACTS, patientFacts: NO_PATIENT_FACTS })).toBeNull();
    expect(evaluateRule(rule, NO_FACTS)).toBeNull();
  });

  it("does not fire below the threshold", () => {
    const rule = ruleById("worsening");

    const match = evaluateRule(rule, {
      ...NO_FACTS,
      assessment: { instrumentId: "phq-9", instrumentTitle: "Опросник phq-9", total: 14, previousTotal: 10, criticalItems: [] },
    });

    expect(match).toBeNull();
  });

  it("gives the same answer on two runs over the same facts", () => {
    const facts: RuleFacts = {
      ...NO_FACTS,
      assessment: { instrumentId: "phq-9", instrumentTitle: "Опросник phq-9", total: 18, previousTotal: 10, criticalItems: [] },
      diary: { value: 2, previousValue: 6 },
      adherence: { consecutiveMissedDoses: 3 },
    };
    const rule = ruleById("worsening");

    expect(evaluateRule(rule, facts)).toEqual(evaluateRule(rule, facts));
    expect(listRules()).toEqual(listRules());
  });
});

describe("GET /api/rules", () => {
  it("gives the doctor every rule with its source", async () => {
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

  it("keeps the rule list away from the patient", async () => {
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
