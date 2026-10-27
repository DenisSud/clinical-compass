/**
 * Замеры контура решений: детерминированный вопросник против генеративной модели.
 *
 * Первое — техника: сколько занимает ответ на 24 случая, какой разброс, повторяем ли
 * ответ. Второе — сравнение: те же случаи, те же ожидаемые вердикты, модель отвечает
 * текстом, движок — файлом. Числа не заменяют клиническую проверку: они показывают
 * цену и стабильность, а не правильность порогов (SPEC S30).
 *
 * Запуск:
 *   npm run bench                 — только движок, плюс отказ, если модель не настроена
 *   LLM_BASE_URL=… LLM_API_KEY=… LLM_MODEL=… npm run bench   — плюс генеративная модель
 *
 * Модель должна отвечать в формате OpenAI chat/completions: этого достаточно для
 * локальной и для облачной модели, и это единственная зависимость бенчмарка.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { listQuestions } from "../server/decisions/registry.js";
import { answerQuestions } from "../server/decisions/runner.js";
import type { RuleFacts } from "../shared/rules.js";

type BenchCase = {
  name: string;
  total: number;
  previousTotal: number | null;
  consecutiveMissedDoses: number | null;
  expect: string[];
  note?: string;
};

const cases = (
  JSON.parse(
    readFileSync(join(import.meta.dirname, "bench", "decisions-cases.json"), "utf8"),
  ) as { cases: BenchCase[] }
).cases;



function factsOf(item: BenchCase): RuleFacts {
  return {
    assessment: {
      instrumentId: "hads-anxiety",
      instrumentVersion: "1.0.0",
      instrumentTitle: "HADS-Т",
      total: item.total,
      previous:
        item.previousTotal === null
          ? null
          : {
              instrumentId: "hads-anxiety",
              instrumentVersion: "1.0.0",
              total: item.previousTotal,
            },
      criticalItems: [],
    },
    diary: null,
    adherence:
      item.consecutiveMissedDoses === null
        ? null
        : { consecutiveMissedDoses: item.consecutiveMissedDoses },
    patientFacts: null,
  };
}

function verdictsOf(list: Array<{ verdict: string }>): string[] {
  return list.map((answer) => answer.verdict);
}

function percentile(values: number[], share: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.floor(share * sorted.length));
  return sorted[index] ?? 0;
}

function micros(nanos: number): string {
  return `${(nanos / 1000).toFixed(1)} мкс`;
}

function runEngine() {
  const questions = listQuestions();

  // Прогрев: первый вызов оплачивает разбор файлов и компиляцию шаблонов, и в p95 он
  // читался бы как «медленный случай», которого нет.
  for (const item of cases) answerQuestions(questions, factsOf(item));

  const times: number[] = [];
  const rows: Array<{ name: string; got: string[]; want: string[]; ok: boolean; micros: number }> = [];

  for (const item of cases) {
    const started = process.hrtime.bigint();
    const answers = answerQuestions(questions, factsOf(item));
    const elapsed = Number(process.hrtime.bigint() - started);
    times.push(elapsed);
    const got = verdictsOf(answers);
    rows.push({
      name: item.name,
      got,
      want: item.expect,
      ok: got.every((verdict, index) => verdict === item.expect[index]),
      micros: elapsed / 1000,
    });
  }

  // Повторяемость: тот же вход обязан дать тот же выход, иначе это не движок, а генератор.
  const first = JSON.stringify(rows.map((row) => row.got));
  const second = JSON.stringify(
    cases.map((item) => verdictsOf(answerQuestions(questions, factsOf(item)))),
  );

  const correct = rows.filter((row) => row.ok).length;
  const refusals = rows.filter((row) => row.got.includes("insufficient")).length;
  const total = times.reduce((sum, value) => sum + value, 0);

  return {
    questions: questions.length,
    cases: rows.length,
    correct,
    refusals,
    totalMicros: total / 1000,
    meanMicros: total / 1000 / rows.length,
    p50Micros: percentile(times, 0.5) / 1000,
    p95Micros: percentile(times, 0.95) / 1000,
    deterministic: first === second,
    rows,
  };
}

type LlmVerdict = { id: string; verdict: string };
type LlmRun = {
  configured: boolean;
  answered: number;
  failed: number;
  correct: number;
  totalMs: number;
  raw?: string;
};

async function askModel(item: BenchCase, questions: ReturnType<typeof listQuestions>): Promise<string | null> {
  const base = process.env.LLM_BASE_URL;
  const key = process.env.LLM_API_KEY;
  const model = process.env.LLM_MODEL;
  if (!base || !key || !model) return null;

  const prompt = [
    "Ты отвечаешь на вопросы о пациенте по данным. Ответ строго JSON без пояснений.",
    "Для каждого вопроса верни verdict: yes, no или insufficient.",
    "insufficient — когда данных для вопроса не хватает; отсутствующее значение не равно нулю.",
    "",
    "Данные:",
    JSON.stringify(
      {
        total: item.total,
        previousTotal: item.previousTotal,
        consecutiveMissedDoses: item.consecutiveMissedDoses,
      },
      null,
      2,
    ),
    "",
    "Вопросы:",
    JSON.stringify(
      questions.map((question) => ({ id: question.id, question: question.question, when: question.when })),
      null,
      2,
    ),
    "",
    'Формат ответа: {"answers":[{"id":"…","verdict":"…"}]}',
  ].join("\n");

  const response = await fetch(`${base.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        { role: "system", content: "Ты клинический ассистент. Отвечай только JSON." },
        { role: "user", content: prompt },
      ],
    }),
  });
  if (!response.ok) throw new Error(`модель ответила ${response.status}`);
  const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return body.choices?.[0]?.message?.content ?? null;
}

function parseVerdicts(raw: string): LlmVerdict[] | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end < 0) return null;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as { answers?: LlmVerdict[] };
    return Array.isArray(parsed.answers) ? parsed.answers : null;
  } catch {
    return null;
  }
}

async function runModel(): Promise<LlmRun> {
  const questions = listQuestions();
  const configured = Boolean(process.env.LLM_BASE_URL && process.env.LLM_API_KEY && process.env.LLM_MODEL);
  if (!configured) return { configured: false, answered: 0, failed: 0, correct: 0, totalMs: 0 };

  let answered = 0;
  let failed = 0;
  let correct = 0;
  const started = Date.now();

  for (const item of cases) {
    let raw: string | null = null;
    try {
      raw = await askModel(item, questions);
    } catch {
      failed += 1;
      continue;
    }
    const parsed = raw === null ? null : parseVerdicts(raw);
    if (parsed === null) {
      failed += 1;
      continue;
    }
    answered += 1;
    const verdicts = questions.map(
      (question) => parsed.find((answer) => answer.id === question.id)?.verdict ?? "missing",
    );
    if (verdicts.every((verdict, index) => verdict === item.expect[index])) correct += 1;
  }

  return { configured, answered, failed, correct, totalMs: Date.now() - started };
}

function table(rows: Array<{ name: string; got: string[]; want: string[]; micros: number }>): void {
  const width = Math.max(...rows.map((row) => row.name.length));
  for (const row of rows) {
    const mark = row.got.every((verdict, index) => verdict === row.want[index]) ? "ok " : "МИМО";
    console.log(
      `  ${mark} ${row.name.padEnd(width)}  ожидали ${row.want.join("/")}, получили ${row.got.join("/")}  ${row.micros.toFixed(1)} мкс`,
    );
  }
}

const engine = runEngine();
console.log("\nДВИЖОК ВОПРОСОВ · детерминированный контур");
console.log(`  вопросов: ${engine.questions}, случаев: ${engine.cases}`);
console.log(`  совпало с ожиданием: ${engine.correct}/${engine.cases}, отказов: ${engine.refusals}`);
console.log(
  `  время: всего ${engine.totalMicros.toFixed(1)} мкс, среднее ${engine.meanMicros.toFixed(1)} мкс, p50 ${engine.p50Micros.toFixed(1)} мкс, p95 ${engine.p95Micros.toFixed(1)} мкс`,
);
console.log(`  повторяемость: ${engine.deterministic ? "да, ответ побайтово тот же" : "НЕТ, ответ меняется"}`);
table(engine.rows);

const model = await runModel();
console.log("\nГЕНЕРАТИВНАЯ МОДЕЛЬ · та же задача, тот же набор случаев");
if (!model.configured) {
  console.log("  не настроена: нужны LLM_BASE_URL, LLM_API_KEY, LLM_MODEL");
  console.log("  сравнение без модели невозможно; движок выше отвечает на те же случаи без сети");
} else {
  console.log(`  ответила: ${model.answered}/${engine.cases}, ошибок разбора: ${model.failed}`);
  console.log(`  совпало с ожиданием: ${model.correct}/${engine.cases}`);
  console.log(`  время: всего ${model.totalMs} мс, среднее ${(model.totalMs / engine.cases).toFixed(0)} мс на случай`);
}

const json = {
  generatedAt: new Date().toISOString(),
  engine: { ...engine, rows: undefined },
  model,
};
const out = process.argv[2];
if (out) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(out, `${JSON.stringify(json, null, 2)}\n`);
  console.log(`\nJSON: ${out}`);
}
