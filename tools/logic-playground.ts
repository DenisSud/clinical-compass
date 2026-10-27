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
import { factAnswerText, factState } from "../shared/facts.js";
import type { PreviousAssessment, RuleCondition, RuleFacts } from "../shared/rules.js";
import { criticalItems, score } from "../server/instruments/engine.js";
import { answerQuestions } from "../server/decisions/runner.js";
import { findQuestion, listQuestions } from "../server/decisions/registry.js";
import { instrument as findInstrument, patientInstruments } from "../server/instruments/loader.js";
import {
  PATIENT_STATUS_IDS,
  instrumentsForStatus,
  patientStatus,
  UnknownStatus,
} from "../server/instruments/statuses.js";
import type { Instrument } from "../server/instruments/schema.js";
import { evaluateRule, findRule, listRules, requireRule } from "../server/rules/registry.js";
import {
  signalsForAdherence,
  signalsForAssessment,
  signalsForDiary,
  signalsForFacts,
  type SignalDraft,
} from "../server/rules/signals.js";
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
  /** Прошлая сумма и шкала, которой она принадлежит: сравнение идёт только внутри пары «шкала + версия». */
  previousTotal: number | null;
  previousInstrumentId: string | null;
  /** Версия прошлой отправки: смена версии ломает сопоставимость (#39). */
  previousVersion: string | null;
  diary: { value: number; previousValue: number | null } | null;
  /** Отметки по конкретным запланированным временам: ключ — «ГГГГ-ММ-ДДTЧЧ:ММ». */
  marks: Record<string, DoseSlotState>;
  /** Причина пропуска, как её вводит пациент: продукт без неё пропуск не принимает. */
  reasons: Record<string, string>;
  /** Пропуски без назначения: когда расписание не нужно, а правило проверить надо. */
  manualSkips: number | null;
  schedule: Schedule | null;
  drugName: string;
  doseValue: number;
  doseUnit: string;
  startsOn: string;
  endsOn: string | null;
  /** Статус пациента: выбирает набор шкал так же, как это сделает врач в карточке (issue #68). */
  status: string;
};

const TODAY = new Date().toLocaleDateString("sv-SE");
const NOW = new Date().toLocaleString("sv-SE").replace(" ", "T").slice(0, 16);

function emptyState(): State {
  return {
    facts: {},
    assessment: null,
    previousTotal: null,
    previousInstrumentId: null,
    previousVersion: null,
    diary: null,
    marks: {},
    reasons: {},
    manualSkips: null,
    schedule: null,
    drugName: "Авиандр",
    doseValue: 20,
    doseUnit: "мг",
    startsOn: shiftDay(TODAY, -2),
    endsOn: null,
    status: "screening",
  };
}

let state = emptyState();

/** Набор шкал текущего статуса — площадка берёт его тем же загрузчиком, что и маршрут пациента. */
function patientSet(): string {
  return patientInstruments(state.status)
    .map((item) => item.id)
    .join(", ");
}

function decisionAnswers() {
  return answerQuestions(listQuestions(), ruleFacts());
}

function questionsTable(): void {
  head(`ВОПРОСЫ К ДАННЫМ · статус ${state.status}`);
  const answers = decisionAnswers();
  if (answers.length === 0) {
    console.log("  ни одного вопроса в content/decisions");
    return;
  }

  for (const answer of answers) {
    const verdict =
      answer.verdict === "yes"
        ? "ДА"
        : answer.verdict === "no"
          ? "нет"
          : `отказ: ${answer.missing.join("; ")}`;
    console.log(`  ${answer.questionId}: ${verdict}`);
    console.log(`    вопрос: ${answer.question}`);
    if (answer.verdict === "yes") console.log(`    ответ: ${answer.title} — ${answer.detail}`);
    console.log(`    источник: ${answer.source.ref} (${answer.source.status})`);
  }
}

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
            instrumentVersion: assessment.instrument.version,
            instrumentTitle: assessment.instrument.title,
            total: scored.total,
            previous: previousForRules(),
            criticalItems: criticalItems(assessment.instrument, assessment.answers),
          }
        : null,
    diary: state.diary,
    adherence: adherenceForRules(),
    patientFacts: factsForRules(),
  };
}

/**
 * Прошлая отправка в том виде, в каком её читает правило: шкала, версия и сумма.
 * Шкала не названа — значит текущая; версия берётся у той шкалы, которой сумма принадлежит.
 */
function previousForRules(): PreviousAssessment | null {
  if (state.previousTotal === null) return null;
  const instrumentId = state.previousInstrumentId ?? state.assessment?.instrument.id;
  if (!instrumentId) return null;

  return {
    instrumentId,
    instrumentVersion: state.previousVersion ?? findInstrument(instrumentId)?.version ?? "",
    total: state.previousTotal,
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
    // Те же слова, что у пациента и у врача: «да» — отмечено, «нет» — не отмечено,
    // «не знаю» — не спрашивали. Сырое значение не отличает ответ от пустоты (#9).
    const status = factState(key, facts);
    const answer = factAnswerText(key, facts);
    const shown =
      status === "not_asked"
        ? "— не спрашивали"
        : `${answer ?? "—"} (${status === "marked" ? "отмечено" : "не отмечено"})`;
    console.log(`  ${label.padEnd(44, ".")} ${shown}`);
  }

  if (state.assessment) {
    const scored = score(state.assessment.instrument, state.assessment.answers);
    const critical = criticalItems(state.assessment.instrument, state.assessment.answers);
    console.log(
      `\nОтветы: «${state.assessment.instrument.title}» — сумма ${scored.total}, диапазон «${scored.band.label}»` +
        (state.previousTotal !== null
          ? `, прошлая сумма ${state.previousTotal} (шкала ${state.previousInstrumentId ?? state.assessment.instrument.id}, версия ${state.previousVersion ?? findInstrument(state.previousInstrumentId ?? state.assessment.instrument.id)?.version ?? "—"})`
          : ""),
    );
    if (critical.length > 0) console.log(`  отмечены пункты: ${critical.join(", ")}`);
  }
  if (state.diary) {
    console.log(
      `\nДневник: ${state.diary.value} из 10` +
        (state.diary.previousValue !== null ? `, предыдущая оценка ${state.diary.previousValue}` : ""),
    );
  }
  const adherence = adherenceForRules();
  if (adherence) console.log(`\nПропусков приёма подряд: ${adherence.consecutiveMissedDoses}`);
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
      const assessment = facts.assessment;
      if (!assessment || assessment.previous === null) return null;

      // Правило молчит не только из-за порога, но и когда сравнивать нечего:
      // площадка обязана назвать причину, иначе «рост 5» без сигнала читается как ошибка.
      const previous = assessment.previous;
      if (previous.instrumentId !== assessment.instrumentId) {
        return `прошлая сумма ${previous.total} — по другой шкале (${previous.instrumentId})`;
      }
      if (previous.instrumentVersion !== assessment.instrumentVersion) {
        return `прошлая сумма ${previous.total} — по версии ${previous.instrumentVersion}, а сейчас ${assessment.instrumentVersion}`;
      }
      return `рост ${assessment.total - previous.total}`;
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

/**
 * Сигналы — тем же кодом, что сервер: `signalsForAssessment`, `signalsForDiary`,
 * `signalsForFacts`. Раздел «Правила» выше объясняет, почему правило молчит; этот
 * показывает ровно ту карточку, которая уйдёт врачу (#42).
 */
function signalDrafts(): SignalDraft[] {
  const assessment = state.assessment;
  const drafts: SignalDraft[] = [];

  if (assessment) {
    const scored = score(assessment.instrument, assessment.answers);
    drafts.push(
      ...signalsForAssessment({
        instrument: assessment.instrument,
        answers: assessment.answers,
        total: scored.total,
        previous: previousForRules(),
      }),
    );
  }
  if (state.diary) drafts.push(...signalsForDiary(state.diary));

  drafts.push(...signalsForFacts(factsForRules()));

  // Карточку пропусков собирает движок вместе с препаратом, дозой, временами и
  // причинами; без этого вызова площадка показывала бы меньше карточек, чем врач.
  // Вопросы к данным отвечают на полном наборе фактов, поэтому площадка зовёт их один раз
  // в конце: ответ «да» уходит врачу той же карточкой, что и правило (Q44).
  for (const answer of decisionAnswers()) {
    if (answer.verdict !== "yes") continue;
    drafts.push({
      kind: `decision:${answer.questionId}`,
      severity: answer.severity!,
      title: answer.title!,
      detail: answer.detail!,
      ruleId: answer.questionId,
    });
  }

  if (state.schedule) {
    const skipped = scheduleRows()
      .filter((row) => row.state === "skipped")
      .slice(-adherenceForRules()!.consecutiveMissedDoses)
      .map((row) => ({ scheduledAt: row.scheduledAt, reason: state.reasons[row.scheduledAt] ?? null }));
    drafts.push(
      ...signalsForAdherence({
        skipped,
        drugName: state.drugName,
        doseValue: state.doseValue,
        doseUnit: state.doseUnit,
      }),
    );
  }

  return drafts;
}

function signalsTable(): void {
  const drafts = signalDrafts();

  console.log("\nСигналы, которые увидит врач:");
  if (drafts.length === 0) {
    console.log("  ни одного — и это ответ, а не пустота: правила не нашли повода.");
    return;
  }

  for (const draft of drafts) {
    console.log(`\n  [${draft.severity.toUpperCase()}] ${draft.title}`);
    console.log(`  ${draft.detail}`);

    const rule = draft.ruleId === null ? undefined : findRule(draft.ruleId);
    if (rule === undefined) {
      const question = draft.ruleId === null ? undefined : findQuestion(draft.ruleId);
      if (question === undefined) {
        console.log("  без правила: сигнал шкалы, а не файл из content/rules");
        continue;
      }
      console.log(`  вопрос «${question.id}» · ${question.source.ref} (${question.source.status})`);
      continue;
    }

    const status =
      rule.source.status === "placeholder"
        ? "наше правило, источник ещё не подтверждён"
        : `источник: ${rule.source.kind}`;
    console.log(`  правило «${rule.id}» · ${status} · ${rule.source.ref}`);
  }

}

function dump(): void {
  head(`СОСТОЯНИЕ · статус ${state.status}, шкалы: ${patientSet()}`);
  factsTable();
  console.log();
  rulesTable();
  questionsTable();
  signalsTable();
}

/**
 * Отметить последние n наступивших приёмов пропуском. Если столько не наступило —
 * отказ, а не тихое обрезание: два разных числа на одном экране читаются как ошибка.
 */
function markLastSkips(n: number, reason: string): boolean {
  const past = scheduleRows().filter((row) => row.scheduledAt <= NOW && row.state !== "scheduled");
  if (n > past.length) {
    console.log(`В окне всего ${past.length} наступивших приёмов — ${n} пропусков отметить нельзя.`);
    return false;
  }
  for (const row of past.slice(-n)) {
    state.marks[row.scheduledAt] = "skipped";
    state.reasons[row.scheduledAt] = reason;
  }
  return true;
}

/** «-1» или «25.10» — в дату ГГГГ-ММ-ДД. */
function resolveDay(token: string): string {
  if (/^-\d+$/.test(token)) return shiftDay(TODAY, Number(token));
  const match = /^(\d{1,2})\.(\d{1,2})$/.exec(token);
  if (match) return `${TODAY.slice(0, 4)}-${match[2]!.padStart(2, "0")}-${match[1]!.padStart(2, "0")}`;
  return token;
}

/** Слоты расписания с их состоянием. Один источник и для таблетницы, и для правила. */
function scheduleRows() {
  if (!state.schedule) return [];

  const slots = plannedSlots(state.schedule, state.startsOn, state.endsOn ?? TODAY);
  return slots.map((slot) => ({
    scheduledAt: slot,
    state: slotState({ scheduledAt: slot, mark: state.marks[slot] ? { status: state.marks[slot] } : undefined, now: NOW }),
  }));
}

function adherenceForRules(): { consecutiveMissedDoses: number } | null {
  if (state.schedule) {
    const rows = scheduleRows();
    const elapsed = rows.filter((row) => row.state !== "scheduled");
    // Как и маршрут: назначение ещё не началось или последний приём не отмечен — это
    // не «ноль пропусков», а отсутствие данных. Площадка отказывает так же (S31).
    if (elapsed.length === 0) return null;
    if (elapsed[elapsed.length - 1]?.state === "no_data") return null;
    return { consecutiveMissedDoses: trailingSkips(rows).length };
  }
  if (state.manualSkips !== null) return { consecutiveMissedDoses: state.manualSkips };
  return null;
}

function pillbox(): void {
  if (!state.schedule) {
    console.log("Назначения нет. Сначала: таблетница 08:00,20:00");
    return;
  }

  const rows = scheduleRows();
  head(
    `ТАБЛЕТНИЦА · ${state.schedule.timesOfDay.join(" и ")} · с ${state.startsOn}` +
      (state.endsOn ? ` по ${state.endsOn}` : "") +
      ` · сейчас ${NOW}`,
  );
  for (const row of rows) {
    const late = row.state === "scheduled" && row.scheduledAt <= NOW ? " (время наступило)" : "";
    console.log(`  ${row.scheduledAt}  ${row.state}${late}`);
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
          state.startsOn = shiftDay(today, -2);
          state.endsOn = null;
          state.marks = {};
        },
      },
      { say: "Смотрим расписание до отметок", run: () => pillbox() },
      {
        say: "Пациент подтвердил три пропуска подряд",
        run: () => markLastSkips(3, "не было препарата"),
      },
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
  "6": {
    title: "Два противопоказания сразу: карточка называет оба",
    steps: [
      { say: "Заполняем СКФ 45 — одно противопоказание", run: () => setFact("скф=45") },
      { say: "Смотрим карточку: названо одно", run: () => dump() },
      {
        say: "Добавляем беременность: в файле правила это второе независимое условие",
        run: () => setFact("беременность=pregnant"),
      },
      {
        say: "Смотрим: одна карточка и в ней оба признака, а не только СКФ (#38)",
        run: () => dump(),
      },
    ],
  },
  "7": {
    title: "Статус выбирает шкалы, вопрос к данным отвечает на событии",
    steps: [
      {
        say: "Пациент только пришёл: скрининг, в наборе один PHQ-9",
        run: () => {
          console.log(`Статус ${state.status}. Шкалы: ${patientSet()}`);
        },
      },
      {
        say: "Врач переводит в лечение: набор меняется файлом, а не кодом",
        run: () => {
          switchStatus("treatment");
          console.log(`Статус ${state.status}. Шкалы: ${patientSet()}`);
        },
      },
      {
        say: "Назначаем приём дважды в день и смотрим расписание",
        run: () => {
          const today = new Date().toLocaleDateString("sv-SE");
          state.schedule = { startsOn: shiftDay(today, -2), endsOn: null, timesOfDay: ["08:00", "20:00"] };
          state.startsOn = shiftDay(today, -2);
          state.endsOn = null;
          state.marks = {};
          pillbox();
        },
      },
      {
        say: "Пациент заполнил HADS-тревогу: сумма выросла с 2 до 21, приёмов не было",
        run: () => {
          applyAssessment("hads-anxiety", {}, 3);
          state.previousTotal = 2;
          markLastSkips(3, "не было препарата");
        },
      },
      {
        say: "Одно событие: вопрос «ухудшение и пропуски» отвечает «да», второй — «нет»",
        run: () => dump(),
      },
      {
        say: "Отмечаем приём: вопрос пересчитывается целиком, цепочка пропусков рвётся",
        run: () => {
          const today = new Date().toLocaleDateString("sv-SE");
          state.marks[`${today}T08:00`] = "taken";
          questionsTable();
        },
      },
    ],
  },
};

/**
 * Смена статуса так, как её делает маршрут: набор шкал берётся из файла, а не из площадки.
 * Прошлые ответы при смене не переписываются: в площадке их и нет, кроме суммы «прошлый».
 */
function switchStatus(next: string): void {
  patientStatus(next);
  state.status = next;
  state.assessment = null;
  state.previousTotal = null;
}

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
  статус [id]                  статус пациента и его набор шкал; без id — просто показать
  вопросы                      вопросы к данным: да, нет или отказ с причиной
  факты                        что мы знаем о пациенте
  факт <поле>=<значение>       эпилепсия=yes, mao=stopped_under_2_weeks, egfr=45,
                               childPugh=B, беременность=pregnant, галактоза=no,
                               факт эпилепсия=null — снова «не спрашивали»
  шкала <id> [все=N] [q9=1]    phq-9, hads-anxiety, hads-depression, asq
  прошлый <балл> [от <шкала> [версия X]]  прошлая сумма, шкала и версия
  дневник <1-10> [было <1-10>] самочувствие сегодня
  пропуски <n> <причина>       отметить последние n наступивших приёмов пропуском
  отметка [-1 | 25.10] 08:00=пропуск(уехал)  отметка на время и день: пропуск
                               (причина обязательна), принял, нет; будущее — отказ
  таблетница 08:00,20:00 [с -5 по -1]  назначение; окно курса в днях от сегодня
  сценарий [1-7]               сценарии выше, с объяснением шагов
  сброс / выход

После каждой команды печатается всё состояние: факты, каждое правило (сработало
или почему нет) и сигналы, которые увидел бы врач. Время, которое ещё не наступило,
остаётся scheduled: отметка на будущее — не приём и не пропуск.
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
    case "статус": {
      const next = rest[0];
      if (next === undefined) {
        const status = patientStatus(state.status);
        console.log(`Статус ${status.id} («${status.label}»). Шкалы: ${patientSet()}`);
        console.log(`Источник набора: ${status.source.ref} (${status.source.status})`);
        return;
      }
      try {
        patientStatus(next);
      } catch (error) {
        if (!(error instanceof UnknownStatus)) throw error;
        console.log(`Нет статуса ${next}. Есть: ${PATIENT_STATUS_IDS.join(", ")}`);
        return;
      }
      switchStatus(next);
      console.log(`Статус ${next}. Шкалы: ${patientSet()}`);
      dump();
      return;
    }
    case "вопросы":
      questionsTable();
      console.log();
      return;
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
        console.log(`Шкалы пациента: ${patientSet()}`);
        return;
      }
      const instrument = findInstrument(id);
      if (!instrument) {
        console.log(`Нет шкалы ${id}. Есть: ${patientSet()}`);
        return;
      }
      // Маршрут пациента отвечает 404 на шкалу не из статуса; площадка отказывает так же,
      // иначе показывала бы опросник, которого пациент не увидит.
      if (!patientInstruments(state.status).some((item) => item.id === id)) {
        console.log(`Шкала ${id} недоступна в статусе ${state.status}. В наборе: ${patientSet()}`);
        return;
      }
      const preset: Record<string, number> = {};
      let fallback: number | null = null;
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

      // Продукт на неполные ответы отвечает 400 («Ответьте на все пункты»), поэтому
      // площадка не подставляет нули молча: это была бы не та сумма, что посчитает сервер.
      if (fallback === null) {
        const answered = instrument.items.filter((item) => item.id in preset).length;
        if (answered !== instrument.items.length) {
          console.log(
            `Отвечено ${answered} из ${instrument.items.length} — продукт такую отправку отклоняет. ` +
              `Укажи все=N или каждый пункт (${instrument.items.map((item) => item.id).join(", ")}).`,
          );
          return;
        }
      }
      try {
        applyAssessment(id, preset, fallback ?? 0);
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
        console.log("Формат: прошлый <балл> [от <шкала>]");
        return;
      }
      state.previousTotal = value;
      state.previousInstrumentId = rest[1] === "от" ? (rest[2] ?? null) : (state.assessment?.instrument.id ?? null);
      state.previousVersion = rest[3] === "версия" ? (rest[4] ?? null) : null;
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
      const reason = rest.slice(1).join(" ").trim();
      if (Number.isNaN(value)) {
        console.log("Формат: пропуски <n> <причина>");
        return;
      }
      if (reason === "") {
        console.log("Продукт не принимает пропуск без причины: пропуски 3 проспал");
        return;
      }
      if (!state.schedule) {
        console.log("Продукт считает пропуски только по назначению: сначала таблетница 08:00,20:00");
        return;
      }
      if (!markLastSkips(value, reason)) return;
      pillbox();
      dump();
      return;
    }
    case "отметка": {
      const [when, raw] = tail.split("=");
      if (!when || !raw) {
        console.log("Формат: отметка [день] 08:00=пропуск | принял | нет, день: -1 или 25.10");
        return;
      }
      const withReason = /^(пропуск|принял|нет)\((.*)\)$/.exec(raw);
      const statusWord = withReason?.[1] ?? raw;
      const reason = withReason?.[2] ?? null;
      const status: DoseSlotState | null =
        statusWord === "пропуск"
          ? "skipped"
          : statusWord === "принял"
            ? "taken"
            : statusWord === "нет"
              ? "no_data"
              : null;
      if (status === null) {
        console.log("Статус: пропуск, принял или нет; причину можно указать в скобках");
        return;
      }
      if (status === "skipped" && reason === null) {
        console.log("Продукт не принимает пропуск без причины: отметка 08:00=пропуск(уехал)");
        return;
      }
      if (!state.schedule) {
        console.log("Сначала назначение: таблетница 08:00,20:00");
        return;
      }
      const parts = when.trim().split(/\s+/);
      const time = parts.pop() ?? "";
      const day = parts.length > 0 ? resolveDay(parts[0]!) : TODAY;
      const slot = `${day}T${time}`;

      if (!/^\d{2}:\d{2}$/.test(time) || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
        console.log("Формат: отметка [-1 | 25.10] 08:00=пропуск | принял | нет");
        return;
      }
      if (slot > NOW) {
        console.log(`Продукт отклонил бы это: ${slot} ещё не наступило (409 dose_in_future).`);
        return;
      }
      if (!scheduleRows().some((row) => row.scheduledAt === slot)) {
        console.log(`В расписании нет приёма на ${slot}`);
        return;
      }
      state.marks[slot] = status;
      if (reason !== null) state.reasons[slot] = reason;
      pillbox();
      dump();
      return;
    }
    case "таблетница": {
      const times = (rest[0] ?? "08:00,20:00").split(",").map((time) => time.trim());
      if (times.some((time) => !/^\d{2}:\d{2}$/.test(time))) {
        console.log("Формат: таблетница 08:00,20:00");
        return;
      }
      // Необязательное окно курса: «с -5 по -1» — дни относительно сегодня.
      let startsOn = shiftDay(TODAY, -2);
      let endsOn: string | null = null;
      const from = rest.findIndex((token) => token === "с");
      if (from >= 0) startsOn = shiftDay(TODAY, Number(rest[from + 1] ?? -2));
      const to = rest.findIndex((token) => token === "по");
      if (to >= 0) endsOn = shiftDay(TODAY, Number(rest[to + 1] ?? 0));

      state.schedule = {
        startsOn,
        endsOn,
        timesOfDay: times.sort(),
      };
      state.startsOn = startsOn;
      state.endsOn = endsOn;
      state.marks = {};
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
