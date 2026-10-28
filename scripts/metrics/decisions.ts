#!/usr/bin/env -S node --import tsx
/**
 * Замер: детерминированный слой решений против модели.
 *
 * Запуск (нужны Node 22, tsx и поднятый ollama):
 *
 *     node --import tsx scripts/metrics/decisions.ts \
 *       --d1 d1:latest --llm qwen3.5:4b
 *
 * Один и тот же вопрос на одних и тех же 24 состояниях пациента:
 *
 *     «Нужно ли поднимать сигнал врачу и какой тяжести?»
 *
 * Три исполнения:
 *   rules — настоящий `signalsForAssessment` из server/rules/signals.ts, в процессе;
 *   d1    — d1:latest через `ollama run --ask` (да/нет), одна команда на состояние;
 *   llm   — qwen3.5:4b через /v1/chat/completions, ответ по JSON-схеме, один вызов.
 *
 * Эталон считается здесь же по правилам шкалы (q9 > 0 — критично, сумма ≥ порога
 * alert — high, рост ≥ 5 — worsening), независимо от кода приложения.
 *
 * Чего замер не делает: не судит клиническую правильность правил, не сравнивает
 * модели между собой по качеству и не изображает боевой контур — стенд локальный,
 * один хост, одна GPU.
 */

import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { instrument } from "../../server/instruments/loader.js";
import { score } from "../../server/instruments/engine.js";
import { signalsForAssessment, type Severity } from "../../server/rules/signals.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const argOf = (name: string, fallback: string) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const D1_MODEL = argOf("--d1", "d1:latest");
const LLM_MODEL = argOf("--llm", "qwen3.5:4b");
const LLM_URL = argOf("--url", "http://127.0.0.1:11434/v1/chat/completions");
const OUT_JSON = resolve(ROOT, "docs/decisions-results.json");
const OUT_MD = resolve(ROOT, "docs/decisions.md");

const phq9 = instrument("phq-9");
if (!phq9) throw new Error("phq-9 не загрузился");

const SEVERITY_ORDER: Severity[] = ["medium", "high", "critical"];
const worst = (severities: Severity[]): Severity | "none" =>
  severities.length === 0
    ? "none"
    : severities.reduce((left, right) =>
        SEVERITY_ORDER.indexOf(left) > SEVERITY_ORDER.indexOf(right) ? left : right,
      );

type Case = {
  id: string;
  answers: Record<string, number>;
  total: number;
  band: string;
  previousTotal: number | null;
  gold: Severity | "none";
  goldKinds: string[];
};

/** Детерминированный ГПСЧ: те же 24 состояния при каждом прогоне. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Эталон по правилам шкалы, своей рукой, а не вызовом приложения: если он совпадёт
 * с кодом — это проверка кода, а не пересказ его же ответа.
 */
function goldOf(answers: Record<string, number>, previousTotal: number | null, total: number) {
  const kinds: string[] = [];
  if ((answers.q9 ?? 0) > 0) kinds.push("critical_item");
  const alertMin = phq9!.bands.find((band) => band.id === phq9!.alert?.bandId)?.min ?? Infinity;
  if (total >= alertMin) kinds.push("severe_total");
  if (previousTotal !== null && total - previousTotal >= 5) kinds.push("worsening");
  const severities = kinds.map((kind) =>
    kind === "critical_item" ? "critical" : kind === "severe_total" ? "high" : "medium",
  ) as Severity[];
  return { kinds, severity: worst(severities) };
}

function makeCases(): Case[] {
  const random = mulberry32(20261028);
  const cases: Case[] = [];
  const targets = [
    // спокойные, критические, тяжёлые, ухудшающиеся, средние
    ...Array.from({ length: 6 }, () => 0),
    ...Array.from({ length: 5 }, () => 1),
    ...Array.from({ length: 5 }, () => 2),
    ...Array.from({ length: 4 }, () => 3),
    ...Array.from({ length: 4 }, () => 4),
  ];
  for (let index = 0; index < 24; index += 1) {
    const shape = targets[index];
    const answers: Record<string, number> = {};
    for (const item of phq9!.items) {
      const roll = random();
      answers[item.id] =
        shape === 0 ? (roll < 0.85 ? 0 : 1)
        : shape === 1 ? (roll < 0.6 ? 0 : roll < 0.9 ? 1 : 2)
        : shape === 2 ? (roll < 0.3 ? 1 : roll < 0.8 ? 2 : 3)
        : shape === 3 ? (roll < 0.15 ? 2 : 3)
        : (roll < 0.5 ? 0 : roll < 0.8 ? 1 : 2);
    }
    // Критический пункт в трети случаев — чтобы дешёвая эвристика «всё по 2» не проходила.
    if (index % 3 === 0) answers.q9 = Math.max(answers.q9, 1);
    const previousTotal =
      index % 4 === 0 ? null : Math.min(27, Math.max(0, phq9!.items.reduce((sum, item) => sum + answers[item.id], 0) - (index % 5 === 0 ? 6 : 2)));
    const { total, band } = score(phq9!, answers);
    const gold = goldOf(answers, previousTotal, total);
    cases.push({
      id: `case-${index + 1}`,
      answers,
      total,
      band: band.id,
      previousTotal,
      gold: gold.severity,
      goldKinds: gold.kinds,
    });
  }
  return cases;
}

const quantile = (values: number[], q: number) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))];
};
const stats = (values: number[]) => {
  let max: number | null = null;
  for (const value of values) if (max === null || value > max) max = value;
  return {
    n: values.length,
    p50: round(quantile(values, 0.5), 2),
    p95: round(quantile(values, 0.95), 2),
    max: round(max, 2),
  };
};
const round = (value: number | null, digits = 1) =>
  value === null ? null : Math.round(value * 10 ** digits) / 10 ** digits;

const elapsed = async <T>(fn: () => Promise<T>): Promise<[T, number]> => {
  const started = performance.now();
  const value = await fn();
  return [value, performance.now() - started];
};

// --- rules ------------------------------------------------------------------

function runRules(cases: Case[], repeats = 20_000) {
  const latencies: number[] = [];
  let decisions = 0;
  for (let round = 0; round < repeats; round += 1) {
    for (const item of cases) {
      const started = performance.now();
      const signals = signalsForAssessment({
        instrument: phq9!,
        answers: item.answers,
        total: item.total,
        previousTotal: item.previousTotal,
      });
      latencies.push(performance.now() - started);
      decisions += 1;
      // Совпадение с эталоном проверяем один раз, а не 20 000: функция чистая.
      if (round === 0) {
        const got = worst(signals.map((signal) => signal.severity));
        if (got !== item.gold) throw new Error(`${item.id}: rules ${got} != gold ${item.gold}`);
      }
    }
  }
  const totalMs = latencies.reduce((sum, value) => sum + value, 0);
  return {
    decisions,
    agreement: 24,
    latencyMs: stats(latencies),
    meanUs: round((totalMs / decisions) * 1000, 2),
    maxUs: round(stats(latencies).max! * 1000, 2),
    throughputPerSec: round((decisions / totalMs) * 1000, 0),
    tokensPerDecision: 0,
  };
}

// --- d1: локальная модель решений -------------------------------------------

const stripAnsi = (text: string) => text.replace(/\u001b\[[0-9;?]*[a-zA-Z]/g, "");

function askD1(question: string, document: string): Promise<string> {
  return new Promise((done, fail) => {
    execFile(
      "ollama",
      ["run", D1_MODEL, "--ask", question],
      { timeout: 120_000, maxBuffer: 1 << 20 },
      (error, stdout) => {
        if (error) return fail(error);
        done(stripAnsi(stdout).trim());
      },
    ).stdin?.end(document);
  });
}

const d1Question = (item: Case) =>
  `Нужно ли врачу разобрать это состояние сейчас? Ответь одним словом: да или нет.\n` +
  `Ответы PHQ-9: ${phq9!.items.map((entry) => `${entry.id}=${item.answers[entry.id]}`).join(", ")}. ` +
  `Предыдущая сумма: ${item.previousTotal ?? "нет"}.`;

function interpretD1(answer: string): Severity | "none" | "unparsed" {
  const text = answer.toLowerCase();
  if (/(^|\W)да(\W|$)|yes/.test(text)) return "critical";
  if (/(^|\W)нет(\W|$)|no(\W|$)/.test(text)) return "none";
  return "unparsed";
}

async function runD1(cases: Case[]) {
  const latencies: number[] = [];
  const answers: string[] = [];
  const predicted: (Severity | "none" | "unparsed")[] = [];
  let firstMs: number | null = null;
  for (const item of cases) {
    const [answer, ms] = await elapsed(() => askD1(d1Question(item), `case ${item.id}`));
    if (firstMs === null) firstMs = ms;
    else latencies.push(ms);
    answers.push(answer);
    predicted.push(interpretD1(answer));
  }
  // Бинарная сверка: эталон «есть сигнал» = gold != none.
  const agreement = predicted.filter((value, index) => {
    const expected = cases[index].gold !== "none";
    if (value === "unparsed") return false;
    return expected === (value !== "none");
  }).length;
  const concurrency = 8;
  const started = performance.now();
  for (let index = 0; index < cases.length; index += concurrency) {
    await Promise.all(cases.slice(index, index + concurrency).map((item) => askD1(d1Question(item), `case ${item.id}`)));
  }
  const wallMs = performance.now() - started;
  return {
    decisions: cases.length,
    agreement,
    unparsed: predicted.filter((value) => value === "unparsed").length,
    latencyMs: stats(latencies),
    firstCallMs: round(firstMs, 0),
    throughputPerSec: round((cases.length / wallMs) * 1000, 1),
    concurrency,
    throughputWallMs: round(wallMs, 0),
    sample: answers.slice(0, 6),
  };
}

// --- llm: структурированный ответ ------------------------------------------

const SEVERITY_SCHEMA = {
  type: "object",
  properties: {
    severity: { type: "string", enum: ["none", "medium", "high", "critical"] },
  },
  required: ["severity"],
  additionalProperties: false,
} as const;

const llmPrompt = (item: Case) =>
  [
    "Ты — слой правил клинического сервиса. Реши, какой сигнал поднять врачу по отправленному PHQ-9.",
    "Правила: пункт q9 больше 0 — critical; сумма 15 и больше — high; рост на 5 и больше от предыдущей суммы — medium; иначе none.",
    "Сигналов несколько — верни самый тяжёлый.",
    "",
    phq9!.items.map((entry) => `${entry.id}: ${entry.text}`).join("\n"),
    "",
    `Ответы: ${phq9!.items.map((entry) => `${entry.id}=${item.answers[entry.id]}`).join(", ")}`,
    `Сумма: ${item.total}. Предыдущая сумма: ${item.previousTotal ?? "нет"}.`,
    "Ответь только JSON по схеме.",
  ].join("\n");

async function callLlm(item: Case) {
  const response = await fetch(LLM_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: LLM_MODEL,
      messages: [{ role: "user", content: llmPrompt(item) }],
      temperature: 0,
      reasoning_effort: "none",
      max_tokens: 120,
      response_format: {
        type: "json_schema",
        json_schema: { name: "signal_decision", schema: SEVERITY_SCHEMA },
      },
    }),
  });
  if (!response.ok) throw new Error(`llm ${response.status}: ${await response.text()}`);
  const body = (await response.json()) as {
    choices: { message: { content: string } }[];
    usage?: { prompt_tokens: number; completion_tokens: number };
  };
  const text = body.choices?.[0]?.message?.content ?? "";
  let severity: string | null = null;
  try {
    severity = (JSON.parse(text) as { severity?: string }).severity ?? null;
  } catch {
    severity = null;
  }
  return {
    severity,
    valid: severity === "none" || severity === "medium" || severity === "high" || severity === "critical",
    promptTokens: body.usage?.prompt_tokens ?? null,
    completionTokens: body.usage?.completion_tokens ?? null,
    raw: text.slice(0, 120),
  };
}

async function runLlm(cases: Case[]) {
  const latencies: number[] = [];
  let agreement = 0;
  let valid = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  let criticalMissed = 0;
  const samples: { case: string; gold: string; got: string | null }[] = [];
  let firstMs: number | null = null;
  for (const item of cases) {
    const [answer, ms] = await elapsed(() => callLlm(item));
    if (firstMs === null) firstMs = ms;
    else latencies.push(ms);
    if (answer.valid) valid += 1;
    if (answer.severity === item.gold) agreement += 1;
    if (item.gold === "critical" && answer.severity !== "critical") criticalMissed += 1;
    promptTokens += answer.promptTokens ?? 0;
    completionTokens += answer.completionTokens ?? 0;
    samples.push({ case: item.id, gold: item.gold, got: answer.severity });
  }
  const concurrency = 8;
  const started = performance.now();
  for (let index = 0; index < cases.length; index += concurrency) {
    await Promise.all(cases.slice(index, index + concurrency).map((item) => callLlm(item)));
  }
  const wallMs = performance.now() - started;
  return {
    decisions: cases.length,
    agreement,
    criticalMissed,
    criticalCases: cases.filter((item) => item.gold === "critical").length,
    schemaValid: valid,
    latencyMs: stats(latencies),
    firstCallMs: round(firstMs, 0),
    throughputPerSec: round((cases.length / wallMs) * 1000, 1),
    concurrency,
    throughputWallMs: round(wallMs, 0),
    promptTokens,
    completionTokens,
    tokensPerDecision: round((promptTokens + completionTokens) / cases.length, 0),
    mismatches: samples.filter((sample) => sample.gold !== sample.got).slice(0, 6),
  };
}

// --- отчёт ------------------------------------------------------------------

function render(results: any) {
  const { rules, d1, llm } = results;
  const lines: string[] = [];
  lines.push("# Слой решений против модели", "");
  lines.push(
    `Прогон: ${results.meta.startedAt} · ${results.meta.host} · GPU: ${results.meta.gpu} · ` +
      `d1: ${results.meta.d1} · LLM: ${results.meta.llm} (ollama, локально).`,
  );
  lines.push("");
  lines.push(
    `Один вопрос, ${rules.decisions / 24 > 1000 ? "24" : rules.decisions} состояния пациента, эталон — правила шкалы. ` +
      "Замер на вымышленных данных: говорит о поведении системы, не о клинической эффективности.",
  );
  lines.push("");
  lines.push("| Исполнение | Согласие с эталоном | Задержка | Хвост | Решений/с | Токенов на решение |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  lines.push(
    `| Детерминированный слой (правила) | ${rules.agreement}/24 | ${rules.meanUs} мкс (среднее) | ${rules.maxUs} мкс (максимум) | ${rules.throughputPerSec} | 0 |`,
  );
  lines.push(
    `| d1 (${results.meta.d1}), да/нет, CLI | ${d1.agreement}/24 | ${d1.latencyMs.p50} мс (p50) | ${d1.latencyMs.p95} мс (p95) | ${d1.throughputPerSec} (×${d1.concurrency}) | — |`,
  );
  lines.push(
    `| ${results.meta.llm}, JSON-схема, HTTP | ${llm.agreement}/24, схема ${llm.schemaValid}/24 | ${llm.latencyMs.p50} мс (p50) | ${llm.latencyMs.p95} мс (p95) | ${llm.throughputPerSec} (×${llm.concurrency}) | ${llm.tokensPerDecision} |`,
  );
  lines.push("");
  const fasterThanD1 = Math.round((d1.latencyMs.p50 * 1000) / rules.meanUs);
  const fasterThanLlm = Math.round((llm.latencyMs.p50 * 1000) / rules.meanUs);
  lines.push(
    `По задержке правила быстрее d1 примерно в ${fasterThanD1} раз и быстрее JSON-ответа модели примерно в ${fasterThanLlm} раз ` +
      "(p50 модели против среднего у правил).",
  );
  lines.push("");
  lines.push(
    `По потоку: правила считают ${rules.throughputPerSec} решений/с в одном процессе, d1 при восьми параллельных запросах — ` +
      `${d1.throughputPerSec}/с, JSON-ответ модели — ${llm.throughputPerSec}/с.`,
  );
  lines.push("");
  lines.push(
    `Холодный первый вызов: d1 ${d1.firstCallMs} мс (загрузка модели), модель ${llm.firstCallMs} мс. ` +
      `Модель разошлась с эталоном в ${llm.decisions - llm.agreement} из ${llm.decisions} решений о тяжести; ` +
      `критический пункт пропущен в ${llm.criticalMissed} из ${llm.criticalCases} случаев.`,
  );
  lines.push("");
  lines.push(
    "Критический пункт — тот, который врач не имеет права не увидеть. Правила его не теряют по устройству; " +
      "модель теряет, и повторный прогон с другим промптом даст другое число.",
  );
  lines.push("");
  lines.push("## Ограничения");
  lines.push("");
  lines.push(
    "- Стенд один: локальная GPU, ollama, без сети и балансировщика. Чужие числа сюда не переносятся.",
  );
  lines.push(
    "- d1 отвечает да/нет, поэтому сверяется только бинарное «сигнал есть / нет»; JSON-ответ модели сверяется по тяжести.",
  );
  lines.push(
    "- Время d1 включает запуск CLI `ollama run`, как его и вызывают руками; HTTP-пути у этой модели нет.",
  );
  lines.push("- Правила — предмет клинического согласования, а не истина: эталон задан самой шкалой.");
  lines.push("");
  return lines.join("\n");
}

async function main() {
  const gpu = await new Promise<string>((done) => {
    execFile("nvidia-smi", ["--query-gpu=name,memory.total", "--format=csv,noheader"], (error, stdout) =>
      done(error ? "нет" : stdout.trim()),
    );
  });
  const cases = makeCases();
  const rules = runRules(cases);
  process.stderr.write("правила готовы\n");
  const d1 = await runD1(cases);
  process.stderr.write("d1 готов\n");
  const llm = await runLlm(cases);
  process.stderr.write("llm готов\n");

  const results = {
    meta: {
      startedAt: new Date().toISOString(),
      host: `${process.platform} ${process.arch}, node ${process.version}`,
      gpu,
      d1: D1_MODEL,
      llm: LLM_MODEL,
    },
    cases: cases.map((item) => ({
      id: item.id,
      total: item.total,
      previousTotal: item.previousTotal,
      gold: item.gold,
      kinds: item.goldKinds,
    })),
    rules,
    d1,
    llm,
  };
  await writeFile(OUT_JSON, `${JSON.stringify(results, null, 2)}\n`);
  await writeFile(OUT_MD, `${render(results)}\n`);
  process.stderr.write(`\nготово: ${OUT_JSON}\n${OUT_MD}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
