import type { PatientFacts } from "./contracts.js";

/**
 * Шесть фактов, блокирующих решение (ОХЛП «Авиандр» §4.3), в том виде, в каком они
 * заданы человеку. Перечень, значения и их смысл задаёт `patientFactsSchema`; здесь
 * только слова — вопрос пациенту, подпись ответа и короткое имя факта.
 *
 * Порогов и слова «противопоказано» здесь нет: порог живёт в content/rules/*.json,
 * вывод — в карточке сигнала у врача (DESIGN.md §2.2). Один и тот же словарь ответов
 * читают оба экрана, поэтому у пациента и у врача не может быть двух разных названий
 * одного ответа.
 */
export type FactAnswer = {
  /** Значение поля `PatientFacts` как оно хранится в контракте. */
  value: string;
  /** Подпись ответа; одна и та же у пациента и у врача. */
  label: string;
  /** `marked` — пациент отметил это у себя; `clear` — ответил, что этого нет. */
  state: "marked" | "clear";
};

type FactBase = {
  key: keyof PatientFacts;
  /** Короткое имя факта: строка у врача и пункт в списке неполноты. */
  label: string;
  /** Вопрос пациенту. В инструкции перечислены противопоказания, вопросы — наши. */
  question: string;
  /** Что мы имеем в виду под вопросом; null — пояснение не нужно. */
  hint: string | null;
};

export type FactQuestion =
  | (FactBase & { kind: "choice"; answers: readonly FactAnswer[] })
  /** `step` — шаг поля ввода: 0.1 там, где значение приходит из анализа с дробью. */
  | (FactBase & { kind: "number"; unit: string; min: number; max: number; step: number });

/** Ответ пациента «не знаю» — это и есть отсутствие ответа, то есть `null` в контракте. */
export const UNANSWERED_ANSWER_LABEL = "Не знаю";

/** Как то же состояние называет список неполноты и карточка врача (GLOSSARY.md: «Не спрашивали»). */
export const NOT_ASKED_LABEL = "Не спрашивали";

const FACT_BY_KEY: Record<keyof PatientFacts, FactQuestion> = {
  epilepsyOrOrganicBrainDisease: {
    kind: "choice",
    key: "epilepsyOrOrganicBrainDisease",
    label: "Эпилепсия или органическое заболевание мозга",
    question: "Были ли у вас эпилепсия или органическое заболевание головного мозга?",
    hint: null,
    answers: [
      { value: "yes", label: "Да", state: "marked" },
      { value: "no", label: "Нет", state: "clear" },
    ],
  },
  maoInhibitors: {
    kind: "choice",
    key: "maoInhibitors",
    label: "Ингибиторы МАО",
    question: "Принимаете ли вы ингибиторы МАО или отменили их меньше двух недель назад?",
    hint: "Ингибиторы МАО — группа антидепрессантов. Если не уверены, что это про вас, ответьте «Не знаю».",
    answers: [
      { value: "current", label: "Да, принимаю сейчас", state: "marked" },
      { value: "stopped_under_2_weeks", label: "Да, отменил(а) меньше двух недель назад", state: "marked" },
      { value: "none", label: "Нет", state: "clear" },
    ],
  },
  egfrMlMin: {
    kind: "number",
    key: "egfrMlMin",
    label: "СКФ (клубочковая фильтрация)",
    question: "Какое у вас значение СКФ — скорость клубочковой фильтрации?",
    hint: "Значение указывают в результатах анализа крови на креатинин. Если результата под рукой нет, ответьте «Не знаю».",
    unit: "мл/мин",
    min: 0,
    max: 200,
    step: 0.1,
  },
  childPugh: {
    kind: "choice",
    key: "childPugh",
    label: "Печёночная недостаточность по Чайлд-Пью",
    question: "Ставили ли вам печёночную недостаточность по Чайлд-Пью — степень A, B или C?",
    hint: "Степень указывают в заключении врача. Если вам такого заключения не ставили, ответьте «Нет»; если ставили, но степень неизвестна — «Не знаю».",
    answers: [
      { value: "A", label: "Степень A", state: "marked" },
      { value: "B", label: "Степень B", state: "marked" },
      { value: "C", label: "Степень C", state: "marked" },
      { value: "none", label: "Нет", state: "clear" },
    ],
  },
  pregnancy: {
    kind: "choice",
    key: "pregnancy",
    label: "Беременность и грудное вскармливание",
    question: "Беременны ли вы сейчас или кормите грудью?",
    hint: "«Ко мне не относится» — если вопрос о беременности к вам не применим.",
    answers: [
      { value: "pregnant", label: "Беременность", state: "marked" },
      { value: "lactating", label: "Грудное вскармливание", state: "marked" },
      { value: "no", label: "Нет", state: "clear" },
      { value: "not_applicable", label: "Ко мне не относится", state: "clear" },
    ],
  },
  galactoseIntolerance: {
    kind: "choice",
    key: "galactoseIntolerance",
    label: "Непереносимость галактозы",
    question: "Есть ли у вас непереносимость галактозы?",
    hint: "Сюда же относится дефицит лактазы и глюкозо-галактозная мальабсорбция, если вам о них говорили.",
    answers: [
      { value: "yes", label: "Да", state: "marked" },
      { value: "no", label: "Нет", state: "clear" },
    ],
  },
};

/** Порядок вопросов — порядок полей контракта: одна последовательность, а не две. */
export const FACT_QUESTIONS: readonly FactQuestion[] = Object.values(FACT_BY_KEY);

export function factQuestion(key: keyof PatientFacts): FactQuestion {
  return FACT_BY_KEY[key];
}

/** Три состояния ответа. «Не спрашивали» — состояние, а не один из вариантов ответа. */
export type FactState = "marked" | "clear" | "not_asked";

export function factState(key: keyof PatientFacts, facts: PatientFacts): FactState {
  const question = FACT_BY_KEY[key];
  const value = facts[key];

  if (question.kind === "number") return value === null ? "not_asked" : "marked";

  const answer = question.answers.find((option) => option.value === value);
  return answer ? answer.state : "not_asked";
}

/**
 * Ответ как он читается вслух: подпись варианта, а для СКФ — значение с единицей.
 * `null` — «не спрашивали»; его подписывает тот экран, который показывает список.
 */
export function factAnswerText(key: keyof PatientFacts, facts: PatientFacts): string | null {
  const question = FACT_BY_KEY[key];
  const value = facts[key];

  if (value === null) return null;
  if (question.kind === "number") return `${String(value)} ${question.unit}`;

  return question.answers.find((option) => option.value === value)?.label ?? null;
}
