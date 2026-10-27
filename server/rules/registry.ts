import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ruleSchema,
  type Rule,
  type RuleCondition,
  type RuleFacts,
  type RuleMatch,
} from "../../shared/rules.js";
import type { PatientFacts } from "../../shared/contracts.js";

const DEFAULT_DIRECTORY = join(import.meta.dirname, "..", "..", "content", "rules");

/** A rule file that does not meet the schema, or a template that names nothing. */
export class InvalidRule extends Error {}

/**
 * Какое имя шаблона даёт факт. Шаблон сверяется с тем, что может дать каждое условие
 * (см. `assertPlaceholders`), поэтому `{drop}` на условии по общей сумме падает при загрузке,
 * а не доходит до врача как заглушка или как 500.
 */
const FACT_VALUES: Record<RuleCondition["fact"], readonly string[]> = {
  "assessment.criticalItem": ["instrument", "items"],
  "assessment.totalIncrease": ["instrument", "total", "previousTotal", "increase"],
  "diary.value": ["value"],
  "diary.drop": ["value", "previousValue", "drop"],
  "adherence.consecutiveMissedDoses": ["missedDoses"],
  "patientFact.epilepsyOrOrganicBrainDisease": ["fact"],
  "patientFact.maoInhibitors": ["fact"],
  "patientFact.egfrMlMin": ["fact"],
  "patientFact.childPugh": ["fact"],
  "patientFact.pregnancy": ["fact"],
  "patientFact.galactoseIntolerance": ["fact"],
};

const PLACEHOLDER = /\{([a-zA-Z][a-zA-Z0-9]*)\}/g;

export function parseRule(value: unknown): Rule {
  const parsed = ruleSchema.safeParse(value);
  if (!parsed.success) {
    const reason = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(корень)"}: ${issue.message}`)
      .join("; ");
    throw new InvalidRule(`правило не прошло схему — ${reason}`);
  }
  assertPlaceholders(parsed.data);
  return parsed.data;
}

/**
 * Читает каждый `*.json` в каталоге. Файл, не прошедший схему, останавливает загрузку: сломанное
 * правило нельзя пропускать молча, потому что пропущенное правило это клиническое правило,
 * переставшее работать без чьего-либо ведома.
 */
function loadRules(directory: string): Rule[] {
  const rules: Rule[] = [];
  const seen = new Set<string>();

  for (const file of readdirSync(directory).filter((name) => name.endsWith(".json")).sort()) {
    const rule = parseRule(JSON.parse(readFileSync(join(directory, file), "utf8")));
    if (seen.has(rule.id)) throw new InvalidRule(`правило ${rule.id} объявлено дважды`);
    seen.add(rule.id);
    rules.push(rule);
  }

  return rules.sort((left, right) => left.id.localeCompare(right.id));
}

let cache: Rule[] | null = null;

/** All registered rules, sorted by id so two runs list them in the same order. */
export function listRules(): Rule[] {
  cache ??= loadRules(DEFAULT_DIRECTORY);
  return cache;
}

/** The stored signal's rule, or undefined once the file behind it is gone. */
export function findRule(id: string): Rule | undefined {
  return listRules().find((rule) => rule.id === id);
}

/**
 * Правило, на которое ссылается движок сигналов. Отсутствующий файл это сломанный контент, а не
 * тихое пустое действие: правило, переставшее срабатывать, должно звучать громче сигнала,
 * которого никогда не было.
 */
export function requireRule(id: string): Rule {
  const rule = findRule(id);
  if (!rule) throw new InvalidRule(`правило ${id} названо в коде, но файла в content/rules нет`);
  return rule;
}

/**
 * Одно правило против фактов одного пациента. Чистое: ни базы, ни часов, ни модели.
 * Возвращает null, когда правило не срабатывает: неизвестный факт («не спрашивали»)
 * никогда не поднимает правило.
 *
 * Каждая совпавшая проверка доходит до карточки, а не только первая: у пациента с
 * СКФ 45 и беременностью два противопоказания из одного правила, и карточка, где названо
 * одно из них, говорит врачу, что другого нет (issue #38).
 */
export function evaluateRule(rule: Rule, facts: RuleFacts): RuleMatch | null {
  const matched = rule.when
    .map((condition) => matchCondition(condition, facts))
    .filter((values): values is Record<string, string> => values !== null);
  if (matched.length === 0) return null;

  const values = joinMatches(matched);

  return {
    ruleId: rule.id,
    title: renderTemplate(rule.output.title, values),
    severity: rule.severity,
    detail: renderTemplate(rule.output.detail, values),
    source: rule.source,
  };
}

/**
 * Одно имя шаблона, несколько совпадений: врач читает их как список. При единственном
 * совпадении значение это та же строка, что правило давало раньше, поэтому правила,
 * проверяющие одно, формулируются ровно как прежде (#38).
 */
function joinMatches(matched: Record<string, string>[]): Record<string, string> {
  const collected = new Map<string, string[]>();

  for (const values of matched) {
    for (const [name, value] of Object.entries(values)) {
      const seen = collected.get(name);
      if (seen === undefined) collected.set(name, [value]);
      else if (!seen.includes(value)) seen.push(value);
    }
  }

  return Object.fromEntries(
    [...collected].map(([name, values]) => [name, values.join("; ")]),
  );
}

function matchCondition(
  condition: RuleCondition,
  facts: RuleFacts,
): Record<string, string> | null {
  switch (condition.fact) {
    case "assessment.criticalItem": {
      const assessment = facts.assessment;
      if (assessment === null) return null;
      if (condition.instrumentId !== undefined && assessment.instrumentId !== condition.instrumentId) {
        return null;
      }
      if (assessment.criticalItems.length === 0) return null;
      return {
        instrument: assessment.instrumentTitle,
        items: assessment.criticalItems.join(", "),
      };
    }

    case "assessment.totalIncrease": {
      const assessment = facts.assessment;
      if (assessment === null) return null;
      if (condition.instrumentId !== undefined && assessment.instrumentId !== condition.instrumentId) {
        return null;
      }

      // Сравнивать можно только ту же шкалу и ту же версию. Сумма HADS-Т — тревога,
      // сумма HADS-Д — депрессия; разница между ними ничего не говорит о пациенте, и
      // "не рекомендовано" здесь мало (decisions.md §4).
      const previous = assessment.previous;
      if (previous === null) return null;
      if (previous.instrumentId !== assessment.instrumentId) return null;
      if (previous.instrumentVersion !== assessment.instrumentVersion) return null;

      const increase = assessment.total - previous.total;
      if (increase < condition.atLeast) return null;

      return {
        instrument: assessment.instrumentTitle,
        total: String(assessment.total),
        previousTotal: String(previous.total),
        increase: String(increase),
      };
    }

    case "diary.value": {
      const diary = facts.diary;
      if (diary === null || diary.value > condition.atMost) return null;
      return { value: String(diary.value) };
    }

    case "diary.drop": {
      const diary = facts.diary;
      if (diary === null || diary.previousValue === null) return null;

      const drop = diary.previousValue - diary.value;
      if (drop < condition.atLeast) return null;

      return {
        value: String(diary.value),
        previousValue: String(diary.previousValue),
        drop: String(drop),
      };
    }

    case "adherence.consecutiveMissedDoses": {
      const adherence = facts.adherence;
      if (adherence === null) return null;

      const missed = adherence.consecutiveMissedDoses;
      if (missed < condition.atLeast) return null;
      return { missedDoses: String(missed) };
    }

    case "patientFact.epilepsyOrOrganicBrainDisease":
    case "patientFact.maoInhibitors":
    case "patientFact.egfrMlMin":
    case "patientFact.childPugh":
    case "patientFact.pregnancy":
    case "patientFact.galactoseIntolerance":
      return matchPatientFact(condition, facts.patientFacts);
  }
}

function matchPatientFact(
  condition: Extract<RuleCondition, { fact: `patientFact.${string}` }>,
  facts: PatientFacts | null,
): Record<string, string> | null {
  if (facts === null) return null;

  switch (condition.fact) {
    case "patientFact.epilepsyOrOrganicBrainDisease":
      return facts.epilepsyOrOrganicBrainDisease === condition.is ? { fact: condition.label } : null;

    case "patientFact.maoInhibitors":
      return facts.maoInhibitors === condition.is ? { fact: condition.label } : null;

    case "patientFact.egfrMlMin": {
      const value = facts.egfrMlMin;
      if (value === null || !(value < condition.below)) return null;
      return { fact: `${condition.label}: ${value} мл/мин (порог ${condition.below})` };
    }

    case "patientFact.childPugh":
      return facts.childPugh === condition.is ? { fact: condition.label } : null;

    case "patientFact.pregnancy":
      return facts.pregnancy === condition.is ? { fact: condition.label } : null;

    case "patientFact.galactoseIntolerance":
      return facts.galactoseIntolerance === condition.is ? { fact: condition.label } : null;
  }
}

export function renderTemplate(template: string, values: Record<string, string>): string {
  return template.replace(PLACEHOLDER, (_match, name: string) => {
    const value = values[name];
    if (value === undefined) throw new InvalidRule(`в шаблоне нет значения для {${name}}`);
    return value;
  });
}

/**
 * Имя шаблона обязано даваться КАЖДЫМ условием, которое может сработать: условия
 * соединены через «или», поэтому любое из них может оказаться единственным совпадением.
 * Проверка по объединению позволяла правилу из двух условий сохранить `{items}` от первого
 * условия и падала при срабатывании, а на маршруте это 500 вместо карточки (issue #47).
 */
function assertPlaceholders(rule: Rule): void {
  assertTemplateNames(`правило ${rule.id}`, [rule.output.title, rule.output.detail], rule.when, "every");
}

/**
 * Какие имена шаблонов условия могут заполнить. `every` это правило правил: проверки
 * соединены через «или», поэтому любая из них может оказаться единственным совпадением.
 * `any` это правило вопросов: все проверки должны выполняться сразу, а значения сливаются,
 * поэтому имя, данное одной проверкой, есть к моменту сборки ответа.
 */
export function assertTemplateNames(
  label: string,
  templates: readonly string[],
  conditions: readonly RuleCondition[],
  mode: "every" | "any",
): void {
  const sets = conditions.map((condition) => new Set(FACT_VALUES[condition.fact]));
  const available =
    mode === "every"
      ? sets.reduce((common, names) => new Set([...common].filter((name) => names.has(name))))
      : new Set(sets.flatMap((names) => [...names]));
  const facts = conditions.map((condition) => condition.fact).join(", ");

  for (const template of templates) {
    for (const match of template.matchAll(PLACEHOLDER)) {
      const name = match[1]!;
      if (!available.has(name)) {
        throw new InvalidRule(
          `${label}: в шаблоне {${name}} нет значения (условия: ${facts}) — ` +
            `ни одно из них не даёт этот факт`,
        );
      }
    }
  }
}
