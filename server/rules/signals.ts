import type { PatientFacts } from "../../shared/contracts.js";
import type { PreviousAssessment, RuleFacts, RuleSeverity } from "../../shared/rules.js";
import { criticalItems } from "../instruments/engine.js";
import { optionsOf, type Instrument } from "../instruments/schema.js";
import { evaluateRule, requireRule } from "./registry.js";

export type Severity = RuleSeverity;

export type SignalDraft = {
  kind: string;
  severity: Severity;
  title: string;
  detail: string;
  /**
   * Правило реестра, поднявшее сигнал. Null для сигнала по полосе шкалы и для правил врача:
   * за ними нет файла правила.
   */
  ruleId: string | null;
};

/**
 * Правила, которые читает движок сигналов, вместе с видом, сохранённым в сигнале. Вид это то,
 * по чему дедуплицирует уникальный индекс и что уже несут карточки в базе; врач читает
 * идентификатор правила и его источник на карточке.
 *
 * Этот список это кодовая сторона теста чётности (rules/parity.test.ts): файл правила без
 * записи здесь не может сработать, а запись без файла за ней останавливает сборку вместо
 * того, чтобы тихо потерять сигнал. Пороги, тяжесть и формулировки живут в
 * content/rules/*.json, а не здесь (decisions.md Q31).
 */
const SIGNAL_RULES = [
  { kind: "critical_item", ruleId: "critical-item" },
  { kind: "worsening", ruleId: "worsening" },
  { kind: "low_wellbeing", ruleId: "diary-low-wellbeing" },
  { kind: "sharp_drop", ruleId: "diary-sharp-drop" },
] as const;

export const SIGNAL_RULE_IDS: readonly string[] = SIGNAL_RULES.map(({ ruleId }) => ruleId);

/**
 * Правила, которые читают строку фактов. Они перечислены отдельно от `SIGNAL_RULES`, потому что
 * срабатывают на `PUT /api/facts`, а не на отправке: `SIGNAL_RULE_IDS` это контракт опросников
 * и дневника, который закрепляет тест чётности, а правило фактов не может быть поднято
 * опросником, который фактов не видит.
 */
export const FACT_SIGNAL_RULES = [
  { kind: "contraindication", ruleId: "aviandr-contraindications" },
] as const;

/**
 * Правила, которые читают отметки приёма в назначении. Перечислены отдельно по той же причине:
 * они срабатывают на `POST /api/doses`, а карточка, которую они поднимают, называет препарат,
 * дозу и пропущенные времена, чего не несёт ни один опросник. Этот список читает тест чётности;
 * саму карточку строит `signalsForAdherence` ниже, а не маршрут (#45).
 */
export const ADHERENCE_SIGNAL_RULES = [
  { kind: "missed_doses", ruleId: "adherence-three-missed-doses" },
] as const;

type SignalRule = { kind: string; ruleId: string };

/**
 * Каждое правило, которое движок может поднять. У файла правила вне этого списка нет пути
 * к врачу, и тест чётности говорит об этом по имени: упоминание идентификатора правила
 * где угодно в исходнике, в комментарии или в константе, путём не является (issue #45).
 */
export const ALL_SIGNAL_RULE_IDS: readonly string[] = [
  ...SIGNAL_RULE_IDS,
  ...FACT_SIGNAL_RULES.map(({ ruleId }) => ruleId),
  ...ADHERENCE_SIGNAL_RULES.map(({ ruleId }) => ruleId),
];

/**
 * Читает ли правило общую сумму шкалы. У шкалы со `scoring: "items"` суммы нет,
 * и правило, написанное про сумму или её рост, не должно получать выдуманное число.
 * Список фактов берётся из файла правила, а не из списка идентификаторов в коде.
 */
function readsTotal(ruleId: string): boolean {
  return requireRule(ruleId).when.some((condition) => condition.fact.startsWith("assessment.total"));
}

/**
 * Факты на входе, сигналы на выходе. Этот модуль даёт только то, о чём реестр не знает,
 * как читать; каждый порог и каждое слово, показанное врачу, берутся из файла правила.
 */
function signalsFromRules(rules: readonly SignalRule[], facts: RuleFacts): SignalDraft[] {
  return rules.flatMap(({ kind, ruleId }) => {
    const match = evaluateRule(requireRule(ruleId), facts);
    if (match === null) return [];

    return [
      {
        kind,
        severity: match.severity,
        title: match.title,
        detail: match.detail,
        ruleId: match.ruleId,
      },
    ];
  });
}

const NO_FACTS: Omit<RuleFacts, "assessment" | "diary"> = {
  adherence: null,
  patientFacts: null,
};

/**
 * Правила читают одну отправку и то, что было до неё, и возвращают сигналы, которых она
 * заслуживает. Они никогда ничего не решают за врача: сигнал это вопрос, на который надо
 * посмотреть, а не указание.
 *
 * Предыдущая отправка приходит значением, которое называет свою шкалу и версию, а не
 * голым числом: сравнение двух шкал здесь невозможно выразить вообще (decisions.md §4).
 */
export function signalsForAssessment(input: {
  instrument: Instrument;
  answers: Record<string, number>;
  total: number;
  previous: PreviousAssessment | null;
}): SignalDraft[] {
  // У шкалы без общей суммы правило «стало хуже по сумме» читало бы число,
  // которого нет, поэтому оно не запускается вовсе (SPEC S10).
  const rules =
    input.instrument.scoring === "items"
      ? SIGNAL_RULES.filter(({ ruleId }) => !readsTotal(ruleId))
      : SIGNAL_RULES;

  const signals = signalsFromRules(rules, {
    ...NO_FACTS,
    assessment: {
      instrumentId: input.instrument.id,
      instrumentVersion: input.instrument.version,
      instrumentTitle: input.instrument.title,
      total: input.total,
      previous: input.previous,
      criticalItems: criticalItems(input.instrument, input.answers),
    },
    diary: null,
  });

  const bandSignal = bandSignalForAssessment(input);
  return bandSignal === null ? signals : [...signals, bandSignal];
}

/**
 * Сигнал по общей сумме принадлежит инструменту, а не файлу правила: порог это тревожная
 * полоса инструмента, а подпись это полоса, в которую сумма действительно попадает
 * (content/instruments/*.json). Ни одного нашего числа здесь не написано.
 */
function bandSignalForAssessment(input: {
  instrument: Instrument;
  total: number;
}): SignalDraft | null {
  // Максимум шкалы — сумма максимумов пунктов: у HADS варианты разные в каждом пункте.
  const topScore = input.instrument.items.reduce((sum, item) => {
    const options = optionsOf(input.instrument, item);
    return sum + Math.max(...options.map((option) => option.value));
  }, 0);
  const alertBand =
    input.instrument.bands.find((band) => band.id === input.instrument.alert?.bandId) ??
    [...input.instrument.bands].sort((left, right) => right.min - left.min)[0];

  if (input.instrument.scoring === "items") return null;
  if (!alertBand || input.total < alertBand.min) return null;

  // Подпись обязана приходить из полосы, в которую сумма действительно попадает, иначе 24
  // читается как «умеренно тяжёлая степень».
  const actualBand = input.instrument.bands.find(
    (band) => input.total >= band.min && input.total <= band.max,
  );
  if (!actualBand) return null;

  return {
    kind: "severe_total",
    severity: "high",
    // Шкала названа в заголовке: «10 из 21» без неё заставляет врача угадывать
    // инструмент по максимуму (Q24, Q28). Тот же довод, что у критического пункта.
    title: `${input.instrument.shortTitle ?? input.instrument.title}: ${actualBand.label.toLowerCase()} — ${input.total} из ${topScore}`,
    detail: `Сумма ответов попала в диапазон «${actualBand.label}» (${actualBand.min}–${actualBand.max}).`,
    ruleId: null,
  };
}

export function signalsForDiary(input: { value: number; previousValue: number | null }): SignalDraft[] {
  return signalsFromRules(SIGNAL_RULES, {
    ...NO_FACTS,
    assessment: null,
    diary: { value: input.value, previousValue: input.previousValue },
  });
}

/**
 * Факты пациента на входе, сигналы на выходе. Вызывается из `PUT /api/facts`, а это
 * единственный момент, когда факт появляется: противопоказание, сохранённое и никогда
 * не поднятое, это правило, которого врач не прочитает (issue #37). Площадка вызывает
 * ту же функцию, поэтому «факты дают сигнал» это одно утверждение и в продукте, и на
 * площадке (issue #42).
 *
 * Факт без ответа это `null`, и «нет» тоже ответ: ни то, ни другое не совпадает с условием,
 * поэтому ничего не поднимается. Уже поднятый сигнал здесь не снимается: его закрытие
 * требует исхода от врача (decisions.md Q17).
 */
export function signalsForFacts(patientFacts: PatientFacts): SignalDraft[] {
  return signalsFromRules(FACT_SIGNAL_RULES, {
    assessment: null,
    diary: null,
    adherence: null,
    patientFacts,
  });
}

/** Пропущенный приём, который карточка может назвать: когда он был запланирован и что сказал пациент. */
export type MissedDose = { scheduledAt: string; reason: string | null };

/** Сколько пропущенных приёмов карточка называет; остальные остаются в числе выше. */
const MAX_LISTED_SKIPS = 3;

function formatSlot(scheduledAt: string): string {
  const [date = "", time = ""] = scheduledAt.split("T");
  const [, month = "", day = ""] = date.split("-");
  return `${day}.${month}, ${time}`;
}

/**
 * Карточка приверженности: серия пропущенных приёмов, начиная с самого раннего. Порог,
 * тяжесть, название и общая формулировка приходят из
 * `content/rules/adherence-three-missed-doses.json` через реестр; эта функция добавляет
 * только то, чего шаблон правила знать не может: препарат, дозу, пропущенные времена
 * и причины самого пациента.
 *
 * Карточка строится здесь, а не на маршруте: карточке, собранной на маршруте, пришлось бы
 * называть правило маршрутом, и «это правило доходит до врача» снова держалось бы на
 * упоминании в тексте исходника (issue #45).
 */
export function signalsForAdherence(input: {
  /** Пропущенные приёмы подряд до текущего момента, начиная с самого раннего. */
  skipped: readonly MissedDose[];
  drugName: string;
  doseValue: number;
  doseUnit: string;
}): SignalDraft[] {
  const signals = signalsFromRules(ADHERENCE_SIGNAL_RULES, {
    assessment: null,
    diary: null,
    adherence: { consecutiveMissedDoses: input.skipped.length },
    patientFacts: null,
  });

  const listed = input.skipped.slice(-MAX_LISTED_SKIPS);
  const times = listed.map((slot) => formatSlot(slot.scheduledAt));
  const reasons = listed.flatMap((slot) => (slot.reason === null ? [] : [slot.reason]));
  // Список времён может быть короче серии; без этой оговорки он читается как полный.
  const scope =
    input.skipped.length > listed.length
      ? `последние ${listed.length} из ${input.skipped.length}: ${times.join(", ")}`
      : `приёмы ${times.join(", ")}`;

  return signals.map((signal) => ({
    ...signal,
    detail:
      `${signal.detail} «${input.drugName}», ${input.doseValue} ${input.doseUnit}: пропущены ${scope}.` +
      (reasons.length > 0 ? ` Причины: ${reasons.join("; ")}.` : ""),
  }));
}
