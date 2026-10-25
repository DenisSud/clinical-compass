/**
 * Площадка логики: факты пациента → правила → сигналы, без интерфейса.
 *
 * Работает на настоящих модулях (`server/rules/registry`, `server/instruments/engine`,
 * `server/prescriptions/schedule`), а не на их копии, поэтому то, что здесь видно, —
 * это то, что сделает приложение.
 *
 * Запуск: npm run play
 *
 * Это часть проекта, а не черновик: изменились пороги, шкалы или расписание —
 * площадка и её сценарии обновляются в том же коммите. Если случай нельзя выразить
 * командой площадки, добавляется команда, а не проверка руками.
 *
 * Ничего не сохраняет: состояние живёт в памяти процесса. База не нужна.
 */
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

import type { PatientFacts } from "../shared/contracts.js";
import { patientFactsSchema } from "../shared/contracts.js";
import type { RuleCondition, RuleFacts } from "../shared/rules.js";
import { criticalItems, score } from "../server/instruments/engine.js";
import { instrument as findInstrument, patientInstruments } from "../server/instruments/loader.js";
import type { Instrument } from "../server/instruments/schema.js";
import { evaluateRule, listRules } from "../server/rules/registry.js";
import {
  plannedSlots,
  shiftDay,
  slotState,
  trailingSkips,
  type Schedule,
} from "../server/prescriptions/schedule.js";
import type { DoseSlotState } from "../shared/contracts.js";

// ────────────────────────────────────────────────────────────── состояние

type State = {
  facts: Partial<PatientFacts>;
  assessment: { instrument: Instrument; answers: Record<string, number> } | null;
  previousTotal: number | null;
  diary: { value: number; previousValue: number | null } | null;
  adherence: { consecutiveMissedDoses: number } | null;
  schedule: Schedule | null;
};

function emptyState(): State {
  return {
    facts: {},
    assessment: null,
    previousTotal: null,
    diary: null,
    adherence: null,
    schedule: null,
  };
}

let state = emptyState();

/** Пустое поле — это «не спрашивали», а не «нет»: правило на нём не срабатывает. */
function factsForRules(): PatientFacts {
  const blank: PatientFacts = {
    epilepsyOrOrganicBrainDisease: null,
    maoInhibitors: null,
    egfrMlMin: null,
    childPugh: null,
    pregnancy: null,
    galactoseIntolerance: null,
  };
  return { ...blank, ...state.facts };
}

function ruleFacts(): RuleFacts {
  const assessment = state.assessment;
  const scored = assessment ? score(assessment.instrument, assessment.answers) : null;

  return {
    assessment:
      assessment && scored
        ? {
            instrumentId: assessment.instrument.id,
            instrumentTitle: assessment.instrument.title,
            total: scored.total,
            previousTotal: state.previousTotal,
            criticalItems: criticalItems(assessment.instrument, assessment.answers),
          }
        : null,
    diary: state.diary,
    adherence: state.adherence,
    patientFacts: factsForRules(),
  };
}

// ────────────────────────────────────────────────────────────── вывод

const LINE = "─".repeat(78);

function head(text: string): void {
  console.log(`\n${LINE}\n${text}\n${LINE}`);
}

function factsTable(): void {
  const facts = factsForRules();
  const names: Array<[keyof PatientFacts, string]> = [
    ["epilepsyOrOrganicBrainDisease", "эпилепсия / органическое заболевание мозга"],
    ["maoInhibitors", "ингибиторы МАО"],
    ["egfrMlMin", "СКФ, мл/мин"],
    ["childPugh", "Чайлд-Пью"],
    ["pregnancy", "беременность / лактация"],
    ["galactoseIntolerance", "непереносимость галактозы"],
  ];

  console.log("Факты пациента:");
  for (const [key, label] of names) {
    const value = facts[key];
    const shown = value === null ? "— не спрашивали" : String(value);
    console.log(`  ${label.padEnd(44, ".")} ${shown}`);
  }

  if (state.assessment) {
    const scored = score(state.assessment.instrument, state.assessment.answers);
    const critical = criticalItems(state.assessment.instrument, state.assessment.answers);
    console.log(
      `\nОтветы: «${state.assessment.instrument.title}» — сумма ${scored.total}, диапазон «${scored.band.label}»` +
        (state.previousTotal !== null ? `, прошлая сумма ${state.previousTotal}` : ""),
    );
    if (critical.length > 0) console.log(`  отмечены пункты: ${critical.join(", ")}`);
  }
  if (state.diary) {
    console.log(
      `\nДневник: ${state.diary.value} из 10` +
        (state.diary.previousValue !== null ? `, предыдущая оценка ${state.diary.previousValue}` : ""),
    );
  }
  if (state.adherence) console.log(`\nПропусков приёма подряд: ${state.adherence.consecutiveMissedDoses}`);
}

/** Условие словами: врач и Антон не должны читать JSON, чтобы понять правило. */
function conditionText(condition: RuleCondition): string {
  switch (condition.fact) {
    case "patientFact.epilepsyOrOrganicBrainDisease":
      return "эпилепсия или органическое заболевание мозга = да";
    case "patientFact.maoInhibitors":
      return condition.is === "current"
        ? "принимает ингибиторы МАО"
        : "отменил ингибиторы МАО меньше двух недель назад";
    case "patientFact.egfrMlMin":
      return `СКФ ниже ${condition.below} мл/мин`;
    case "patientFact.childPugh":
      return `Чайлд-Пью ${condition.is}`;
    case "patientFact.pregnancy":
      return condition.is === "pregnant" ? "беременность" : "грудное вскармливание";
    case "patientFact.galactoseIntolerance":
      return "непереносимость галактозы = да";
    case "assessment.criticalItem":
      return "критический пункт отмечен";
    case "assessment.totalIncrease":
      return `сумма выросла на ${condition.atLeast} и больше`;
    case "diary.value":
      return `самочувствие ${condition.atMost} и ниже`;
    case "diary.drop":
      return `самочувствие упало на ${condition.atLeast} и больше`;
    case "adherence.consecutiveMissedDoses":
      return `${condition.atLeast} пропуска подряд и больше`;
  }
}

/** Что у нас на самом деле. null — «не спрашивали» или нет данных: правило не срабатывает. */
function conditionActual(condition: RuleCondition, facts: RuleFacts): string | null {
  if (condition.fact.startsWith("patientFact.")) {
    const key = condition.fact.replace("patientFact.", "") as keyof PatientFacts;
    const value = facts.patientFacts?.[key] ?? null;
    return value === null ? null : String(value);
  }

  switch (condition.fact) {
    case "assessment.criticalItem": {
      if (!facts.assessment) return null;
      return facts.assessment.criticalItems.length > 0
        ? `отмечены: ${facts.assessment.criticalItems.join(", ")}`
        : "ни один не отмечен";
    }
    case "assessment.totalIncrease": {
      if (!facts.assessment || facts.assessment.previousTotal === null) return null;
      return `рост ${facts.assessment.total - facts.assessment.previousTotal}`;
    }
    case "diary.value":
      return facts.diary === null ? null : `${facts.diary.value} из 10`;
    case "diary.drop": {
      if (!facts.diary || facts.diary.previousValue === null) return null;
      return `упало на ${facts.diary.previousValue - facts.diary.value}`;
    }
    case "adherence.consecutiveMissedDoses":
      return facts.adherence === null ? null : `${facts.adherence.consecutiveMissedDoses} подряд`;
  }
}

function rulesTable(): void {
  const facts = ruleFacts();

  console.log("Правила:");
  for (const rule of listRules()) {
    const match = evaluateRule(rule, facts);
    const status =
      rule.source.status === "placeholder"
        ? "наше, не подтверждено"
        : `подтверждено: ${rule.source.kind}`;
    console.log(`\n  ${match ? "●" : "○"} ${rule.id}  [${rule.severity}]  (${status})`);
    console.log(`    ${rule.title}`);

    if (match) {
      console.log(`    СРАБОТАЛО: ${match.title}`);
      console.log(`    ${match.detail}`);
      console.log(`    источник: ${rule.source.ref}`);
      continue;
    }

    const known = rule.when
      .map((condition) => ({ text: conditionText(condition), actual: conditionActual(condition, facts) }))
      .filter((entry) => entry.actual !== null);

    if (known.length === 0) {
      console.log(`    не сработало: данных нет — ${rule.when.map(conditionText).join("; ")}`);
      continue;
    }

    for (const entry of known) {
      console.log(`    не сработало: нужно «${entry.text}» — у нас ${entry.actual}`);
    }
  }
}

function signalsTable(): void {
  const facts = ruleFacts();
  const fired = listRules()
    .map((rule) => evaluateRule(rule, facts))
    .filter((match): match is NonNullable<typeof match> => match !== null);

  console.log("\nСигналы, которые увидит врач:");
  if (fired.length === 0) {
    console.log("  ни одного — и это ответ, а не пустота: правила не нашли повода.");
    return;
  }

  for (const match of fired) {
    const status =
      match.source.status === "placeholder"
        ? "наше правило, источник ещё не подтверждён"
        : `источник: ${match.source.kind}`;
    console.log(`\n  [${match.severity.toUpperCase()}] ${match.title}`);
    console.log(`  ${match.detail}`);
    console.log(`  правило «${match.ruleId}» · ${status} · ${match.source.ref}`);
  }
}

function dump(): void {
  head("СОСТОЯНИЕ");
  factsTable();
  console.log();
  rulesTable();
  signalsTable();
}

function pillbox(): void {
  if (!state.schedule) {
    console.log("Назначения нет. Сначала: таблетница 08:00,20:00");
    return;
  }

  const today = new Date().toLocaleDateString("sv-SE");
  const from = shiftDay(today, -2);
  const slots = plannedSlots(state.schedule, from, today);
  const now = new Date().toLocaleString("sv-SE").replace(" ", "T").slice(0, 16);

  // Отметки — те же, что ставит пациент: приём отмечен, пропуск подтверждён,
  // пусто — значит «нет данных», а не «пропустил».
  const marks: Record<string, { status: DoseSlotState }> = {};
  if (state.adherence) {
    const missed = slots.filter((slot) => slot <= now).slice(-state.adherence.consecutiveMissedDoses);
    for (const slot of missed) marks[slot] = { status: "skipped" };
  }

  const rows = slots.map((slot) => ({
    scheduledAt: slot,
    state: slotState({ scheduledAt: slot, mark: marks[slot], now }),
  }));

  head(`ТАБЛЕТНИЦА · ${state.schedule.timesOfDay.join(" и ")} · с ${state.schedule.startsOn}`);
  for (const row of rows) {
    console.log(`  ${row.scheduledAt}  ${row.state}`);
  }

  const skips = trailingSkips(rows);
  console.log(`\nПодряд пропусков (подтверждённых пациентом): ${skips.length}`);
  if (skips.length > 0) console.log(`  цепочка: ${skips.map((slot) => slot.scheduledAt).join(", ")}`);
  console.log("Пустая отметка после наступившего времени — «нет данных», а не нарушение.");
}

// ────────────────────────────────────────────────────────────── сценарии

function applyAssessment(instrumentId: string, preset: Record<string, number>, fallback = 0): void {
  const instrument = findInstrument(instrumentId);
  if (!instrument) throw new Error(`нет шкалы ${instrumentId}`);
  const answers = Object.fromEntries(
    instrument.items.map((item) => [item.id, preset[item.id] ?? fallback]),
  );
  state.assessment = { instrument, answers };
}

type Scenario = { title: string; steps: Array<{ say: string; run: () => void }> };

const SCENARIOS: Record<string, Scenario> = {
  "1": {
    title: "Спокойный пациент: умеренная сумма, критических пунктов нет",
    steps: [
      { say: "PHQ-9: все ответы по 1 баллу, девятый пункт — 0", run: () => applyAssessment("phq-9", { q9: 0 }, 1) },
      { say: "Смотрим, что из этого следует", run: () => dump() },
    ],
  },
  "2": {
    title: "Критический пункт: девятый вопрос PHQ-9 отмечен",
    steps: [
      { say: "PHQ-9: девятый пункт — 1, остальные по 0", run: () => applyAssessment("phq-9", { q9: 1 }, 0) },
      { say: "Смотрим, что из этого следует", run: () => dump() },
    ],
  },
  "3": {
    title: "Противопоказание: СКФ ниже 60",
    steps: [
      { say: "Заполняем только СКФ, остальное не спрашивали", run: () => { state.facts.egfrMlMin = 45; } },
      { say: "Смотрим: правило ОХЛП срабатывает, остальные молчат на неизвестном", run: () => dump() },
      {
        say: "Отвечаем «нет» на эпилепсию: правило то же, но теперь видно, что ответ учтён",
        run: () => {
          state.facts.epilepsyOrOrganicBrainDisease = "no";
          dump();
        },
      },
    ],
  },
  "4": {
    title: "Таблетница: два приёма в день и три пропуска подряд",
    steps: [
      {
        say: "Назначаем приём два раза в день, начиная с позавчера",
        run: () => {
          const today = new Date().toLocaleDateString("sv-SE");
          state.schedule = { startsOn: shiftDay(today, -2), endsOn: null, timesOfDay: ["08:00", "20:00"] };
          state.adherence = null;
        },
      },
      { say: "Смотрим расписание до отметок", run: () => pillbox() },
      { say: "Пациент подтвердил три пропуска подряд", run: () => { state.adherence = { consecutiveMissedDoses: 3 }; } },
      { say: "Смотрим: расписание и сигнал приверженности", run: () => { pillbox(); dump(); } },
    ],
  },
  "5": {
    title: "ASQ: один утвердительный ответ — один сигнал, а не два",
    steps: [
      { say: "ASQ: первый вопрос — «да», остальные «нет»", run: () => applyAssessment("asq", { q1: 1 }, 0) },
      { say: "Смотрим: критический сигнал есть, суммы-сигнала нет", run: () => dump() },
    ],
  },
};

async function runScenario(key: string): Promise<void> {
  const scenario = SCENARIOS[key];
  if (!scenario) {
    console.log(`Нет сценария «${key}». Есть: ${Object.keys(SCENARIOS).join(", ")}`);
    return;
  }

  state = emptyState();
  head(`СЦЕНАРИЙ ${key}. ${scenario.title}`);
  for (const [index, step] of scenario.steps.entries()) {
    console.log(`\n${index + 1}) ${step.say}`);
    step.run();
  }
  console.log("\nКонец сценария. `сброс` — начать заново.");
}

// ────────────────────────────────────────────────────────────── команды

const HELP = `
Команды:
  правила                      все правила с источником и состоянием
  факты                        что мы знаем о пациенте
  факт <поле>=<значение>       эпилепсия=yes, mao=stopped_under_2_weeks, egfr=45,
                               childPugh=B, беременность=pregnant, галактоза=no,
                               факт эпилепсия=null — снова «не спрашивали»
  шкала <id> [все=N] [q9=1]    phq-9, gad-7, asq
  прошлый <балл>               прошлая сумма, чтобы проверить ухудшение
  дневник <1-10> [было <1-10>] самочувствие сегодня
  пропуски <n>                 пропусков подряд
  таблетница <08:00,20:00>     назначение на два приёма в день
  сценарий [1-5]               сценарии выше, с объяснением шагов
  сброс / выход

После каждой команды печатается всё состояние: факты, каждое правило (сработало
или почему нет) и сигналы, которые увидел бы врач.
`;

function setFact(raw: string): void {
  const [rawKey, rawValue] = raw.split("=");
  const aliases: Record<string, keyof PatientFacts> = {
    эпилепсия: "epilepsyOrOrganicBrainDisease",
    epilepsy: "epilepsyOrOrganicBrainDisease",
    mao: "maoInhibitors",
    мао: "maoInhibitors",
    egfr: "egfrMlMin",
    скф: "egfrMlMin",
    childPugh: "childPugh",
    чайлд: "childPugh",
    беременность: "pregnancy",
    pregnancy: "pregnancy",
    галактоза: "galactoseIntolerance",
    galactose: "galactoseIntolerance",
  };

  const key = aliases[rawKey ?? ""] ?? (rawKey as keyof PatientFacts);
  if (!(key in patientFactsSchema.shape)) {
    console.log(`Нет такого факта: ${rawKey}`);
    return;
  }
  if (rawValue === undefined) {
    console.log("Формат: факт <поле>=<значение>");
    return;
  }

  const value = rawValue === "null" ? null : /^\d+$/.test(rawValue) ? Number(rawValue) : rawValue;
  const parsed = patientFactsSchema.partial().safeParse({ [key]: value });
  if (!parsed.success) {
    console.log(`Не принято схемой: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`);
    return;
  }

  state.facts = { ...state.facts, [key]: value as never };
}

function handle(input: string, ask: () => Promise<string>): void | Promise<void> {
  const [command = "", ...rest] = input.trim().split(/\s+/);
  const tail = rest.join(" ");

  switch (command) {
    case "":
      return;
    case "выход":
    case "exit":
      return ask().then(() => undefined);
    case "правила":
      head("ПРАВИЛА");
      rulesTable();
      console.log();
      return;
    case "факты":
      head("ФАКТЫ");
      factsTable();
      console.log();
      return;
    case "факт":
      setFact(tail);
      dump();
      return;
    case "шкала": {
      const [id, ...pairs] = rest;
      if (!id) {
        console.log(`Шкалы пациента: ${patientInstruments().map((i) => i.id).join(", ")}`);
        return;
      }
      const preset: Record<string, number> = {};
      let fallback = 0;
      for (const pair of pairs) {
        const [key, raw] = pair.split("=");
        const value = Number(raw);
        if (Number.isNaN(value)) {
          console.log(`Не понял «${pair}»`);
          return;
        }
        if (key === "все") fallback = value;
        else if (key) preset[key] = value;
      }
      try {
        applyAssessment(id, preset, fallback);
      } catch (error) {
        console.log((error as Error).message);
        return;
      }
      dump();
      return;
    }
    case "прошлый": {
      const value = Number(rest[0]);
      if (Number.isNaN(value)) {
        console.log("Формат: прошлый <балл>");
        return;
      }
      state.previousTotal = value;
      dump();
      return;
    }
    case "дневник": {
      const value = Number(rest[0]);
      if (Number.isNaN(value) || value < 1 || value > 10) {
        console.log("Формат: дневник <1-10> [было <1-10>]");
        return;
      }
      const previous = rest[1] === "было" ? Number(rest[2]) : state.diary?.value ?? null;
      state.diary = { value, previousValue: previous };
      dump();
      return;
    }
    case "пропуски": {
      const value = Number(rest[0]);
      if (Number.isNaN(value)) {
        console.log("Формат: пропуски <n>");
        return;
      }
      state.adherence = { consecutiveMissedDoses: value };
      if (state.schedule) pillbox();
      dump();
      return;
    }
    case "таблетница": {
      const times = (rest[0] ?? "08:00,20:00").split(",").map((time) => time.trim());
      if (times.some((time) => !/^\d{2}:\d{2}$/.test(time))) {
        console.log("Формат: таблетница 08:00,20:00");
        return;
      }
      const today = new Date().toLocaleDateString("sv-SE");
      state.schedule = { startsOn: shiftDay(today, -2), endsOn: null, timesOfDay: times.sort() };
      pillbox();
      dump();
      return;
    }
    case "сценарий":
      return runScenario(rest[0] ?? "1");
    case "сброс":
      state = emptyState();
      console.log("Сброшено. Ничего не сохраняется.");
      return;
    default:
      console.log(`Не знаю команды «${command}». help — список.`);
  }
}

async function main(): Promise<void> {
  const rl = createInterface({ input: stdin, output: stdout });

  head("ПЛОЩАДКА ЛОГИКИ · черновик, ничего не сохраняет");
  console.log("Правила и шкалы — настоящие: те же файлы, что читает приложение.");
  console.log("help — команды, сценарий 1 — пройти по шагам.");

  process.stdout.write("\n> ");
  for await (const line of rl) {
    if (["выход", "exit"].includes(line.trim())) break;
    if (line.trim() === "help") {
      console.log(HELP);
      process.stdout.write("\n> ");
      continue;
    }
    const result = handle(line, () => Promise.resolve());
    if (result instanceof Promise) await result;
    process.stdout.write("\n> ");
  }
  rl.close();
}

await main();
