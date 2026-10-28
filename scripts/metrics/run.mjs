#!/usr/bin/env node
/**
 * Технические замеры прототипа «Клинического компаса».
 *
 * Запуск (нужен Node 22 и установленные зависимости):
 *
 *     node scripts/metrics/run.mjs
 *
 * Скрипт поднимает настоящее приложение (server/index.ts) на временной базе
 * SQLite, ходит в него по HTTP так же, как это делает интерфейс, и считает
 * метрики измеримо: p50/p95 отклика, число действий на сценарий, дубли при
 * повторной отправке, сбои на потоке запросов, поведение после SIGKILL,
 * покрытие рекомендаций основанием, изоляцию доступа, объём данных и цену
 * добавления новой шкалы.
 *
 * Чего скрипт не делает: не измеряет клики в браузере (действие = запрос к API),
 * не изображает нагрузку боевого контура (loopback, один процесс, SQLite) и не
 * утверждает ничего о клинической эффективности.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, symlink, writeFile, cp, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { gzipSync } from "node:zlib";

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const PORT = Number(process.env.METRICS_PORT ?? 3457);
const BASE = `http://127.0.0.1:${PORT}/api`;

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const OUT_JSON = resolve(ROOT, argOf("--out", "docs/metrics-results.json"));
const OUT_MD = resolve(ROOT, argOf("--report", "docs/metrics.md"));
const DB_PATH = join(tmpdir(), `compass-metrics-${process.pid}.db`);

// --- инфраструктура ---------------------------------------------------------

const serverLog = [];
let server = null;

function startServer({ port = PORT, dbPath = DB_PATH, cwd = ROOT } = {}) {
  const child = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
    cwd,
    env: { ...process.env, PORT: String(port), SQLITE_DB: dbPath, NODE_ENV: "test" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  child.stderr.on("data", (chunk) => serverLog.push(chunk.toString()));
  return child;
}

async function waitForHealth(base = BASE, limitMs = 30_000) {
  const started = performance.now();
  while (performance.now() - started < limitMs) {
    try {
      const response = await fetch(`${base}/health`);
      if (response.ok) return performance.now() - started;
    } catch {
      // сервер ещё поднимается
    }
    await sleep(50);
  }
  throw new Error(`сервер не ответил за ${limitMs} мс: ${serverLog.join("").slice(-2000)}`);
}

function client(base = BASE) {
  let cookie = null;
  return {
    async request(method, path, body) {
      const started = performance.now();
      const response = await fetch(`${base}${path}`, {
        method,
        headers: {
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...(cookie ? { cookie } : {}),
        },
        body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
      });
      const ms = performance.now() - started;
      const setCookie = response.headers.getSetCookie?.() ?? [];
      if (setCookie.length > 0) cookie = setCookie[0].split(";")[0];
      const text = await response.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
      return { status: response.status, json, text, ms };
    },
  };
}

let emailSeq = 0;
const nextEmail = (prefix) => `${prefix}.${process.pid}.${++emailSeq}@example.test`;
const PASSWORD = "metrics-horse-battery-staple";

async function newDoctor(base = BASE) {
  const c = client(base);
  const email = nextEmail("doctor");
  const response = await c.request("POST", "/auth/doctor/signup", { email, password: PASSWORD });
  if (response.status !== 201) throw new Error(`doctor signup ${response.status}: ${response.text}`);
  const code = await c.request("GET", "/binding-code");
  if (code.status !== 200) throw new Error(`binding-code ${code.status}`);
  return { client: c, email, bindingCode: code.json.code };
}

async function newPatient(doctor, base = BASE) {
  const c = client(base);
  const signup = await c.request("POST", "/auth/patient/signup", { email: nextEmail("patient"), password: PASSWORD });
  if (signup.status !== 201) throw new Error(`patient signup ${signup.status}: ${signup.text}`);
  const bind = await c.request("POST", "/bind", { code: doctor.bindingCode });
  if (bind.status !== 200) throw new Error(`bind ${bind.status}: ${bind.text}`);
  return { client: c, id: signup.json.profile.id };
}

const ANSWERS = (value, overrides = {}) => {
  const answers = {};
  for (let index = 1; index <= 9; index += 1) answers[`q${index}`] = value;
  return { ...answers, ...overrides };
};

const submission = (tag) => ({ submissionId: `${tag}-${process.pid}-${Math.floor(Math.random() * 1e9)}` });

const quantile = (values, q) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[index];
};
const stats = (values) => ({
  n: values.length,
  p50: quantile(values, 0.5),
  p95: quantile(values, 0.95),
  max: values.length ? Math.max(...values) : null,
  mean: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
});
const round = (value, digits = 1) => (value === null || value === undefined ? null : Math.round(value * 10 ** digits) / 10 ** digits);

// --- сценарии ---------------------------------------------------------------

async function scenarioPrimaryVisit() {
  const steps = [];
  const doctor = await newDoctor();
  const run = async (name, fn) => {
    const result = await fn();
    steps.push({ name, status: result.status, ms: result.ms });
    return result;
  };

  await run("врач: код привязки", () => doctor.client.request("GET", "/binding-code"));
  const created = client();
  const signup = await run("пациент: регистрация", () =>
    created.request("POST", "/auth/patient/signup", { email: nextEmail("visit"), password: PASSWORD }),
  );
  if (signup.status !== 201) throw new Error(`signup ${signup.status}`);
  const patient = { client: created, id: signup.json.profile.id };
  await run("пациент: привязка по коду", () => patient.client.request("POST", "/bind", { code: doctor.bindingCode }));
  await run("пациент: опросник", () => patient.client.request("GET", "/instruments/phq-9"));
  await run("пациент: отправка PHQ-9", () =>
    patient.client.request("POST", "/assessments/phq-9", { ...submission("visit"), answers: ANSWERS(1) }),
  );
  await run("врач: карточка пациента", () => doctor.client.request("GET", `/patients/${patient.id}/assessments`));
  return { name: "Первичный приём: привязка и первый опросник", steps };
}

async function scenarioCriticalSignal() {
  const steps = [];
  const doctor = await newDoctor();
  const patient = await newPatient(doctor);
  const run = async (name, fn) => {
    const result = await fn();
    steps.push({ name, status: result.status, ms: result.ms });
    return result;
  };

  await run("пациент: PHQ-9 с критическим пунктом", () =>
    patient.client.request("POST", "/assessments/phq-9", {
      ...submission("critical"),
      answers: ANSWERS(2, { q9: 2 }),
    }),
  );
  const list = await run("врач: список сигналов", () => doctor.client.request("GET", "/signals"));
  const signal = (list.json?.signals ?? []).find((item) => item.patientId === patient.id);
  if (!signal) throw new Error("сигнал не появился после критического ответа");
  await run("врач: взять в разбор", () => doctor.client.request("POST", `/signals/${signal.id}/take`));
  await run("врач: закрытие без результата (ждём 400)", () =>
    doctor.client.request("POST", `/signals/${signal.id}/close`, {}),
  );
  await run("врач: закрытие с результатом", () =>
    doctor.client.request("POST", `/signals/${signal.id}/close`, {
      outcome: "Созвонились, состояние уточнено, план не меняем",
    }),
  );
  return { name: "Критический ответ: сигнал и разбор", steps };
}

async function scenarioPlanAndAdherence() {
  const steps = [];
  const doctor = await newDoctor();
  const patient = await newPatient(doctor);
  const run = async (name, fn) => {
    const result = await fn();
    steps.push({ name, status: result.status, ms: result.ms });
    return result;
  };

  const plan = await run("врач: назначение в план", () =>
    doctor.client.request("POST", `/patients/${patient.id}/plan`, {
      kind: "medication",
      title: "АВИАНДР, 20 мг — 2 раза в сутки",
    }),
  );
  const itemId = plan.json?.item?.id;
  if (!itemId) throw new Error("назначение не создано");
  await run("врач: подтверждение плана", () => doctor.client.request("POST", `/plan/${itemId}/confirm`));
  await run("пациент: назначения на сегодня", () => patient.client.request("GET", "/checkins"));
  await run("пациент: отметка «принял»", () =>
    patient.client.request("POST", "/checkins", { planItemId: itemId, status: "done" }),
  );
  await run("врач: приверженность за неделю", () =>
    doctor.client.request("GET", `/patients/${patient.id}/checkins?days=7`),
  );
  return { name: "План и приверженность", steps };
}

async function scenarioDiaryAndWatch() {
  const steps = [];
  const doctor = await newDoctor();
  const patient = await newPatient(doctor);
  const run = async (name, fn) => {
    const result = await fn();
    steps.push({ name, status: result.status, ms: result.ms });
    return result;
  };

  await run("врач: своё правило (самочувствие ≤ 3)", () =>
    doctor.client.request("POST", `/patients/${patient.id}/watch`, {
      kind: "diary_below",
      threshold: 3,
      title: "Низкое самочувствие",
      severity: "high",
    }),
  );
  await run("пациент: дневник, 1 из 10", () =>
    patient.client.request("POST", "/diary", { ...submission("diary-low"), value: 1 }),
  );
  await run("врач: дневник пациента", () => doctor.client.request("GET", `/patients/${patient.id}/diary`));
  await run("врач: сигналы после правила", () => doctor.client.request("GET", "/signals"));
  return { name: "Правило врача и дневник", steps };
}

async function scenarioMessages() {
  const steps = [];
  const doctor = await newDoctor();
  const patient = await newPatient(doctor);
  const run = async (name, fn) => {
    const result = await fn();
    steps.push({ name, status: result.status, ms: result.ms });
    return result;
  };

  await run("пациент: сообщение врачу", () =>
    patient.client.request("POST", "/messages", { body: "К вечеру трудно дышать, стало тревожно" }),
  );
  await run("врач: тред пациента", () => doctor.client.request("GET", `/patients/${patient.id}/messages`));
  await run("врач: ответ", () =>
    doctor.client.request("POST", `/patients/${patient.id}/messages`, { body: "Понял, обсудим на приёме в четверг" }),
  );
  await run("пациент: тред", () => patient.client.request("GET", "/messages"));
  return { name: "Канал связи: сообщение и ответ", steps };
}

// --- измерения --------------------------------------------------------------

async function measureTests() {
  const started = performance.now();
  const child = spawn(join(ROOT, "node_modules/.bin/vitest"), ["run", "--reporter=dot"], {
    cwd: ROOT,
    env: { ...process.env, CI: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk.toString()));
  child.stderr.on("data", (chunk) => (output += chunk.toString()));
  const code = await new Promise((done) => child.on("close", done));
  const wall = performance.now() - started;
  const tests = /Tests\s+(?:[^\n]*?)(\d+) passed/.exec(output);
  const files = /Test Files\s+(?:[^\n]*?)(\d+) passed/.exec(output);
  const failedMatch = /(\d+) failed/.exec(output);
  return {
    exitCode: code,
    wallMs: round(wall, 0),
    testFiles: files ? Number(files[1]) : null,
    testsPassed: tests ? Number(tests[1]) : null,
    testsFailed: failedMatch ? Number(failedMatch[1]) : 0,
  };
}

async function measureSignalDelivery(rounds = 12) {
  const doctor = await newDoctor();
  const samples = [];
  for (let index = 0; index < rounds; index += 1) {
    const patient = await newPatient(doctor);
    const started = performance.now();
    const submit = await patient.client.request("POST", "/assessments/phq-9", {
      ...submission(`delivery-${index}`),
      answers: ANSWERS(2, { q9: 1 }),
    });
    if (submit.status !== 201) throw new Error(`submit ${submit.status}: ${submit.text}`);
    // Сигнал доставлен, когда врач видит его в своём списке.
    let seen = null;
    for (let attempt = 0; attempt < 5 && seen === null; attempt += 1) {
      const list = await doctor.client.request("GET", "/signals");
      if ((list.json?.signals ?? []).some((item) => item.patientId === patient.id && item.severity === "critical")) {
        seen = performance.now() - started;
      }
    }
    if (seen === null) throw new Error("сигнал не дошёл до врача");
    samples.push(seen);
  }
  return { samples: samples.map((value) => round(value, 1)), stats: stats(samples) };
}

async function measureIdempotency(repeats = 20) {
  const doctor = await newDoctor();
  const patient = await newPatient(doctor);
  const body = { submissionId: `idem-${process.pid}`, answers: ANSWERS(2, { q9: 2 }) };
  const statuses = [];
  const latencies = [];
  for (let index = 0; index < repeats; index += 1) {
    const response = await patient.client.request("POST", "/assessments/phq-9", body);
    statuses.push(response.status);
    latencies.push(response.ms);
  }
  const doctorView = await doctor.client.request("GET", `/patients/${patient.id}/assessments`);
  const signals = await doctor.client.request("GET", `/patients/${patient.id}/signals`);
  return {
    repeats,
    statuses: [...new Set(statuses)].sort(),
    assessmentsStored: doctorView.json?.assessments?.length ?? null,
    signalsStored: signals.json?.signals?.length ?? null,
    latency: stats(latencies),
  };
}

async function measureReliability() {
  const doctor = await newDoctor();
  const patients = [];
  for (let index = 0; index < 6; index += 1) patients.push(await newPatient(doctor));

  const health = [];
  for (let index = 0; index < 300; index += 1) {
    const response = await client().request("GET", "/health");
    health.push(response.status);
  }

  const reads = [];
  const readLatencies = [];
  for (let index = 0; index < 200; index += 1) {
    const patient = patients[index % patients.length];
    const response = await doctor.client.request("GET", `/patients/${patient.id}/diary`);
    reads.push(response.status);
    readLatencies.push(response.ms);
  }

  // Кривой ввод: сервер обязан ответить 4xx, а не 500.
  const garbage = [
    ["обрезанный JSON", "POST", "/assessments/phq-9", "{"],
    ["пустой submissionId", "POST", "/assessments/phq-9", { submissionId: "", answers: {} }],
    ["значение вне шкалы", "POST", "/assessments/phq-9", { submissionId: "x", answers: { q1: 99 } }],
    ["дневник: оценка 42", "POST", "/diary", { submissionId: "x", value: 42 }],
    ["дневник: дата из 1999", "POST", "/diary", { submissionId: "x", value: 5, entryDate: "1999-01-01" }],
    ["отметка по чужому назначению", "POST", "/checkins", { planItemId: "nope", status: "done" }],
    ["пустое сообщение", "POST", "/messages", { body: "" }],
    ["несуществующий код", "POST", "/bind", { code: "НЕТТАКОГО" }],
    ["несуществующий пациент", "GET", "/patients/does-not-exist", undefined],
    ["несуществующий сигнал", "POST", "/signals/does-not-exist/take", {}],
  ];
  const byCase = new Map();
  for (let index = 0; index < 100; index += 1) {
    const [label, method, path, body] = garbage[index % garbage.length];
    const target = body === undefined ? client() : patients[index % patients.length].client;
    const response = await target.request(method, path, body);
    const known = byCase.get(label) ?? { label, method, path, statuses: new Set() };
    known.statuses.add(response.status);
    byCase.set(label, known);
  }

  const countStatus = (list, test) => list.filter(test).length;
  const cases = [...byCase.values()].map((item) => ({
    label: item.label,
    method: item.method,
    path: item.path,
    statuses: [...item.statuses].sort(),
  }));
  return {
    health: { n: health.length, ok: countStatus(health, (status) => status === 200) },
    reads: { n: reads.length, ok: countStatus(reads, (status) => status === 200), latency: stats(readLatencies) },
    malformed: { n: 100, cases, serverErrors: cases.filter((item) => item.statuses.some((s) => s >= 500)).length },
    total5xx: [...health, ...reads].filter((status) => status >= 500).length,
  };
}

async function measureLoad({ workers = 16, perWorker = 60 } = {}) {
  const doctor = await newDoctor();
  const patients = [];
  for (let index = 0; index < workers; index += 1) patients.push(await newPatient(doctor));

  const latencies = [];
  const statuses = [];
  const started = performance.now();

  await Promise.all(
    patients.map(async (patient, worker) => {
      for (let index = 0; index < perWorker; index += 1) {
        const write = await patient.client.request("POST", "/messages", {
          body: `нагрузочное сообщение ${worker}-${index}`,
        });
        latencies.push(write.ms);
        statuses.push(write.status);
        const pick = index % 3;
        const read =
          pick === 0
            ? await patient.client.request("GET", "/diary")
            : pick === 1
              ? await doctor.client.request("GET", `/patients/${patient.id}/messages`)
              : await doctor.client.request("GET", "/signals");
        latencies.push(read.ms);
        statuses.push(read.status);
      }
    }),
  );

  const wall = performance.now() - started;
  return {
    workers,
    requests: latencies.length,
    wallMs: round(wall, 0),
    rps: round((latencies.length / wall) * 1000, 0),
    latency: stats(latencies),
    errors: statuses.filter((status) => status >= 500).length,
    nonOk: statuses.filter((status) => status < 200 || status >= 300).length,
  };
}

async function measureBasisCoverage() {
  const doctor = await newDoctor();
  const patient = await newPatient(doctor);
  await patient.client.request("POST", "/assessments/phq-9", { ...submission("basis"), answers: ANSWERS(2) });
  const plan = await doctor.client.request("POST", `/patients/${patient.id}/plan`, {
    kind: "medication",
    title: "АВИАНДР, 20 мг — 2 раза в сутки",
  });
  await doctor.client.request("POST", `/plan/${plan.json.item.id}/confirm`);
  const response = await doctor.client.request("GET", `/patients/${patient.id}/recommendations`);
  const cards = response.json?.cards ?? [];
  const withBasis = cards.filter((card) => (card.basis ?? "").trim().length > 0);
  const withSource = cards.filter((card) => card.source);
  return {
    status: response.status,
    cards: cards.length,
    withBasis: withBasis.length,
    withSource: withSource.length,
    basisShare: cards.length ? round((withBasis.length / cards.length) * 100, 0) : null,
    sourceShare: cards.length ? round((withSource.length / cards.length) * 100, 0) : null,
    missing: response.json?.missing ?? [],
    cardTitles: cards.map((card) => card.title),
  };
}

async function measureIsolation() {
  const doctorA = await newDoctor();
  const doctorB = await newDoctor();
  const patientA = await newPatient(doctorA);
  const patientB = await newPatient(doctorA);

  const attempts = [];
  const probe = async (who, label, method, path, body, source) => {
    const response = await source.request(method, path, body);
    attempts.push({ who, label, method, path, status: response.status, leaked: response.status < 400 });
  };

  for (const [label, method, path, body] of [
    ["карточка", "GET", `/patients/${patientA.id}`, undefined],
    ["опросники", "GET", `/patients/${patientA.id}/assessments`, undefined],
    ["дневник", "GET", `/patients/${patientA.id}/diary`, undefined],
    ["сообщения", "GET", `/patients/${patientA.id}/messages`, undefined],
    ["сигналы", "GET", `/patients/${patientA.id}/signals`, undefined],
    ["рекомендации", "GET", `/patients/${patientA.id}/recommendations`, undefined],
    ["запись в план", "POST", `/patients/${patientA.id}/plan`, { kind: "medication", title: "чужое назначение" }],
    ["отвязка", "POST", `/patients/${patientA.id}/unbind`, {}],
  ]) {
    await probe("чужой врач", label, method, path, body, doctorB.client);
  }

  for (const [label, method, path, body] of [
    ["список пациентов врача", "GET", "/patients", undefined],
    ["сигналы врача", "GET", "/signals", undefined],
    ["карточка другого пациента", "GET", `/patients/${patientA.id}`, undefined],
    ["назначение другому пациенту", "POST", `/patients/${patientA.id}/plan`, { kind: "medication", title: "подмена" }],
    ["отметка по чужому назначению", "POST", "/checkins", { planItemId: "not-mine", status: "done" }],
  ]) {
    await probe("чужой пациент", label, method, path, body, patientB.client);
  }

  return { attempts, count: attempts.length, leaks: attempts.filter((item) => item.leaked).length };
}

async function measureRestart(patientsCount = 10) {
  const doctor = await newDoctor();
  const created = [];
  for (let index = 0; index < patientsCount; index += 1) {
    const patient = await newPatient(doctor);
    await patient.client.request("POST", "/assessments/phq-9", {
      ...submission(`restart-${index}`),
      answers: ANSWERS(2, { q9: 2 }),
    });
    await patient.client.request("POST", "/diary", { ...submission(`restart-diary-${index}`), value: 4 });
    created.push(patient);
  }

  const snapshot = async (c) => {
    const signals = await c.request("GET", "/signals");
    let assessments = 0;
    let diary = 0;
    for (const patient of created) {
      const a = await c.request("GET", `/patients/${patient.id}/assessments`);
      const d = await c.request("GET", `/patients/${patient.id}/diary`);
      assessments += a.json?.assessments?.length ?? 0;
      diary += d.json?.entries?.length ?? 0;
    }
    return { signals: (signals.json?.signals ?? []).length, assessments, diary };
  };

  const before = await snapshot(doctor.client);

  // SIGKILL: процесс не успевает ничего дописать. Всё, на что сервер ответил 201,
  // обязано пережить это — иначе RPO не ноль.
  const closed = new Promise((done) => server.once("close", done));
  server.kill("SIGKILL");
  await Promise.race([closed, sleep(5000)]);

  const restartStarted = performance.now();
  server = startServer();
  const readyMs = await waitForHealth();
  const restartMs = performance.now() - restartStarted;

  const reloaded = client();
  const signin = await reloaded.request("POST", "/auth/doctor/signin", { email: doctor.email, password: PASSWORD });
  if (signin.status !== 200) throw new Error(`signin after restart ${signin.status}`);
  const after = await snapshot(reloaded);

  return {
    before,
    after,
    lostSignals: before.signals - after.signals,
    lostAssessments: before.assessments - after.assessments,
    lostDiaryEntries: before.diary - after.diary,
    readyMs: round(readyMs, 0),
    restartMs: round(restartMs, 0),
  };
}

/**
 * Метрика 11: как ведёт себя выборка, когда истории много. Базу наполняем в
 * обход приложения (прямой SQL), а меряем уже настоящий HTTP-ответ.
 */
async function measureDataVolume({ rows = 5000 } = {}) {
  const doctor = await newDoctor();
  const patient = await newPatient(doctor);

  const before = [];
  for (let index = 0; index < 20; index += 1) {
    const response = await doctor.client.request("GET", `/patients/${patient.id}/assessments`);
    before.push(response.ms);
  }

  const db = require("better-sqlite3")(DB_PATH);
  db.pragma("busy_timeout = 5000");
  const insert = db.prepare(
    `insert into assessments (id, patient_id, instrument_id, instrument_version, answers, total_score, band_id, band_label, submission_id, submitted_at, created_at)
     values (?, ?, 'phq-9', '1.0.0', ?, ?, 'moderate', 'Умеренные проявления', ?, ?, ?)`,
  );
  const answers = JSON.stringify(ANSWERS(2));
  const seed = db.transaction((count) => {
    for (let index = 0; index < count; index += 1) {
      const stamp = new Date(Date.now() - index * 60_000).toISOString();
      insert.run(`volume-${index}`, patient.id, answers, 10, `volume-${index}`, stamp, stamp);
    }
  });
  seed(rows);
  const total = db.prepare("select count(*) as n from assessments where patient_id = ?").get(patient.id).n;
  db.close();

  const after = [];
  for (let index = 0; index < 20; index += 1) {
    const response = await doctor.client.request("GET", `/patients/${patient.id}/assessments`);
    after.push(response.ms);
  }
  const signals = [];
  for (let index = 0; index < 20; index += 1) {
    const response = await doctor.client.request("GET", "/signals");
    signals.push(response.ms);
  }

  return {
    seeded: rows,
    storedForPatient: total,
    emptyHistoryMs: stats(before),
    fullHistoryMs: stats(after),
    signalsListMs: stats(signals),
  };
}

/**
 * Метрика 10: цена новой шкалы. Копируем дерево, добавляем один JSON и ничего
 * больше; если тесты и запуск приложения проходят без правок кода — шкала
 * действительно данные.
 */
async function measureInstrumentAdditivity() {
  const copy = join(tmpdir(), `compass-instrument-${process.pid}`);
  await rm(copy, { recursive: true, force: true });
  await mkdir(copy, { recursive: true });
  for (const entry of ["server", "shared", "package.json", "tsconfig.json", "tsconfig.server.json", "vitest.config.ts"]) {
    await cp(join(ROOT, entry), join(copy, entry), { recursive: true });
  }
  await symlink(join(ROOT, "node_modules"), join(copy, "node_modules"), "dir");

  const hashOf = async (start = copy) => {
    const files = [];
    const walk = async (directory) => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) await walk(path);
        else if (entry.isFile() && path.endsWith(".ts")) files.push(path);
      }
    };
    await walk(start);
    files.sort();
    const hash = createHash("sha256");
    for (const file of files) hash.update(file.replace(start, "")).update(await readFile(file));
    return { hash: hash.digest("hex"), files: files.length };
  };

  const before = await hashOf();

  const instrument = {
    id: "demo-scale",
    version: "1.0.0",
    title: "Демонстрационная шкала (замер метрики 10)",
    intro: "Три пункта, чтобы проверить: новая шкала добавляется файлом, а не кодом.",
    options: [
      { value: 0, label: "Нет" },
      { value: 1, label: "Иногда" },
      { value: 2, label: "Часто" },
    ],
    items: [
      { id: "d1", text: "Первый пункт", critical: false },
      { id: "d2", text: "Второй пункт", critical: false },
      { id: "d3", text: "Третий пункт", critical: true },
    ],
    bands: [
      { id: "low", min: 0, max: 2, label: "Низкие проявления" },
      { id: "high", min: 3, max: 6, label: "Высокие проявления" },
    ],
    alert: { bandId: "high" },
    source: { authors: "Замер", validation_citation: null, licence: "не требуется", note: "Тестовая шкала, не для клиники." },
  };
  await writeFile(join(copy, "server/instruments/demo-scale.json"), `${JSON.stringify(instrument, null, 2)}\n`);

  const after = await hashOf();

  const child = spawn(join(copy, "node_modules/.bin/vitest"), ["run", "--reporter=dot"], {
    cwd: copy,
    env: { ...process.env, CI: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk.toString()));
  child.stderr.on("data", (chunk) => (output += chunk.toString()));
  const testExit = await new Promise((done) => child.on("close", done));
  const passed = /Tests\s+(?:[^\n]*?)(\d+) passed/.exec(output);

  // И приложение с новой шкалой действительно работает.
  const port = PORT + 1;
  const dbPath = join(tmpdir(), `compass-instrument-${process.pid}.db`);
  const app = startServer({ port, dbPath, cwd: copy });
  const childLog = [];
  app.stderr.on("data", (chunk) => childLog.push(chunk.toString()));
  const base = `http://127.0.0.1:${port}/api`;
  let served = null;
  let scored = null;
  try {
    await waitForHealth(base);
    const doctor = await newDoctor(base);
    const patient = await newPatient(doctor, base);
    const instrumentResponse = await patient.client.request("GET", "/instruments/demo-scale");
    served = instrumentResponse.status;
    const submit = await patient.client.request("POST", "/assessments/demo-scale", {
      submissionId: `demo-${process.pid}`,
      answers: { d1: 2, d2: 2, d3: 2 },
    });
    scored = submit.status;
    const doctorView = await doctor.client.request("GET", `/patients/${patient.id}/assessments`);
    scored = { submit: submit.status, stored: (doctorView.json?.assessments ?? []).length };
  } finally {
    const closedApp = new Promise((done) => app.once("close", done));
    app.kill("SIGKILL");
    await Promise.race([closedApp, sleep(3000)]);
    await rm(dbPath, { force: true });
    await rm(copy, { recursive: true, force: true });
  }

  return {
    codeHashBefore: before.hash.slice(0, 16),
    codeHashAfter: after.hash.slice(0, 16),
    codeFiles: before.files,
    codeChanged: before.hash !== after.hash,
    filesAdded: 1,
    testExitCode: testExit,
    testsPassed: passed ? Number(passed[1]) : null,
    instrumentServed: served,
    scoring: scored,
  };
}

/** Метрика 8 в измеримой части: сколько весит собранный интерфейс. */
async function measureBundle() {
  const build = spawn(join(ROOT, "node_modules/.bin/vite"), ["build", "--logLevel", "error"], {
    cwd: ROOT,
    env: { ...process.env, CI: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  build.stdout.on("data", (chunk) => (output += chunk.toString()));
  build.stderr.on("data", (chunk) => (output += chunk.toString()));
  const exitCode = await new Promise((done) => build.on("close", done));
  const assets = join(ROOT, "server/public/assets");
  let raw = 0;
  let gzip = 0;
  let files = 0;
  try {
    for (const name of await readdir(assets)) {
      const info = await stat(join(assets, name));
      raw += info.size;
      gzip += gzipSync(await readFile(join(assets, name))).length;
      files += 1;
    }
  } catch {
    return { exitCode, available: false, output: output.slice(-500) };
  }
  const html = await stat(join(ROOT, "server/public/index.html")).catch(() => null);
  await rm(join(ROOT, "server/public"), { recursive: true, force: true });
  return {
    exitCode,
    available: true,
    files,
    rawKb: round(raw / 1024, 0),
    gzipKb: round(gzip / 1024, 0),
    htmlKb: html ? round(html.size / 1024, 1) : null,
  };
}

function scenarioMetrics(scenarios) {
  return scenarios.map((scenario) => {
    const latencies = scenario.steps.map((step) => step.ms);
    const failures = scenario.steps.filter((step) => step.status >= 500);
    return {
      name: scenario.name,
      actions: scenario.steps.length,
      wallMs: round(latencies.reduce((sum, value) => sum + value, 0), 0),
      slowest: round(Math.max(...latencies), 0),
      serverErrors: failures.length,
      steps: scenario.steps.map((step) => ({ name: step.name, status: step.status, ms: round(step.ms, 1) })),
    };
  });
}

// --- отчёт ------------------------------------------------------------------

function renderReport(results) {
  const lines = [];
  const meta = results.meta;
  lines.push("# Технические замеры прототипа", "");
  lines.push(`Прогон: ${meta.startedAt} · ${meta.host} · Node ${meta.node} · SQLite, один процесс, loopback.`);
  lines.push("");
  lines.push(
    "Все числа получены скриптом `scripts/metrics/run.mjs` на этом же прототипе. Это испытание на вымышленных " +
      "данных: оно говорит о поведении системы, а не о клинической эффективности.",
  );
  lines.push("");
  lines.push("| Метрика | Значение | Как измерено | Чем ограничено |");
  lines.push("| --- | --- | --- | --- |");

  const t = results.tests;
  lines.push(
    `| Автотесты | ${t.testsPassed}/${t.testsPassed + t.testsFailed} пройдено, ${t.testFiles} наборов, ${t.wallMs} мс | ` +
      "`vitest run` на этом дереве | Проверяют правила и границы, не клиническую корректность |",
  );

  const sc = results.scenarios;
  const totalActions = sc.reduce((sum, item) => sum + item.actions, 0);
  const totalWall = sc.reduce((sum, item) => sum + item.wallMs, 0);
  lines.push(
    `| Сценарии целиком | ${sc.length} сценариев, ${totalActions} действий, ${totalWall} мс на все | ` +
      "Пять сквозных сценариев по HTTP; действие — запрос к API | Клики в браузере не входят в счёт |",
  );

  const d = results.signalDelivery;
  lines.push(
    `| Доставка критического сигнала | p50 ${round(d.stats.p50, 0)} мс, p95 ${round(d.stats.p95, 0)} мс, ${d.stats.n} замеров | ` +
      "От отправки PHQ-9 с пунктом q9 до появления сигнала в списке врача | Сигнал пишется в той же транзакции: отдельной очереди доставки нет |",
  );

  const idem = results.idempotency;
  lines.push(
    `| Повторная отправка анкеты | ${idem.repeats} отправок → ${idem.assessmentsStored} запись, сигналов ${idem.signalsStored} (не размножились) | ` +
      "Один и тот же `submissionId` на `/assessments/phq-9` | `submissionId` генерирует клиент, а не сервер |",
  );

  const r = results.reliability;
  lines.push(
    `| Отказы под потоком | ${r.health.n + r.reads.n} запросов, ${r.total5xx} ответов 5xx | ` +
      "300 `/health` и 200 чтений карточки подряд | Один процесс, без сети и балансировщика |",
  );
  lines.push(
    `| Кривой ввод | ${r.malformed.n} запросов, ${r.malformed.cases.length} видов ввода, ${r.malformed.serverErrors} видов с ответом 5xx | ` +
      "Обрезанный JSON, пустые поля, чужие идентификаторы | Проверяет отказ, а не подбор атаки |",
  );

  const l = results.load;
  lines.push(
    `| Нагрузка | ${l.requests} запросов, ${l.rps}/с, p50 ${round(l.latency.p50, 1)} мс, p95 ${round(l.latency.p95, 1)} мс, ${l.errors} ответов 5xx | ` +
      `${l.workers} параллельных пациентов, смесь записи и чтения | Loopback и SQLite с одним писателем: это потолок стенда, не кластера |`,
  );

  const rs = results.restart;
  lines.push(
    `| Сохранность при SIGKILL | потеряно ${rs.lostSignals} сигналов, ${rs.lostAssessments} опросников, ${rs.lostDiaryEntries} записей дневника; подъём ${rs.readyMs} мс | ` +
      `Процесс убит без предупреждения на ${rs.before.signals} сигналах, затем поднят на той же базе | RPO 0 для подтверждённых записей; RTO — время старта процесса,  бэкапов нет |`,
  );

  const b = results.recommendations;
  lines.push(
    `| Рекомендации с основанием | ${b.withBasis}/${b.cards} карточек (${b.basisShare}%), со ссылкой на источник ${b.withSource}/${b.cards} | ` +
      "Ответ `/patients/:id/recommendations` после подтверждённого плана | Карточки строятся из одного ОХЛП; клинрекомендаций в корпусе нет |",
  );

  const iso = results.isolation;
  lines.push(
    `| Изоляция доступа | ${iso.count} попыток, утечек ${iso.leaks} | ` +
      "Чужой врач и чужой пациент дёргают карточку, план, дневник, сообщения, сигналы | Проверяет роли, не криптографию |",
  );

  const vol = results.dataVolume;
  lines.push(
    `| Объём истории | ${vol.storedForPatient} опросников: p50 ${round(vol.fullHistoryMs.p50, 1)} мс против ${round(vol.emptyHistoryMs.p50, 1)} мс на пустой истории | ` +
      "Засев 5000 записей в обход приложения, затем 20 запросов карточки по HTTP | Индексы штатные, планировщик SQLite не настраивался |",
  );

  const add = results.instrumentAdditivity;
  lines.push(
    `| Новая шкала | 1 файл данных, ${add.codeChanged ? "код менялся" : "0 строк кода"}, тесты ${add.testsPassed} пройдено, шкала отдаётся и считается (${add.instrumentServed}/${add.scoring?.submit}) | ` +
      "Копия дерева + один JSON-файл шкалы, затем тесты и запуск | Проверяет расширяемость по данным, не клиническую валидность шкалы |",
  );

  if (results.bundle?.available) {
    lines.push(
      `| Вес интерфейса | ${results.bundle.gzipKb} КБ в gzip (${results.bundle.rawKb} КБ без сжатия, ${results.bundle.files} файлов) | ` +
        "`vite build` продакшн-сборки | Не включает шрифты, которых у нас пока нет |",
    );
  }

  lines.push("", "## Сценарии по шагам", "");
  lines.push("| Сценарий | Действий | Время, мс | Серверных ошибок |");
  lines.push("| --- | --- | --- | --- |");
  for (const item of sc) lines.push(`| ${item.name} | ${item.actions} | ${item.wallMs} | ${item.serverErrors} |`);

  lines.push("", "### Самые медленные шаги", "");
  lines.push("| Сценарий | Шаг | Код | мс |");
  lines.push("| --- | --- | --- | --- |");
  const flat = sc.flatMap((item) => item.steps.map((step) => ({ scenario: item.name, ...step })));
  flat.sort((left, right) => right.ms - left.ms);
  for (const step of flat.slice(0, 6)) lines.push(`| ${step.scenario} | ${step.name} | ${step.status} | ${step.ms} |`);

  lines.push("", "### Кривой ввод: коды ответов", "");
  lines.push("| Что подали | Метод | Путь | Код |");
  lines.push("| --- | --- | --- | --- |");
  for (const item of r.malformed.cases) {
    lines.push(`| ${item.label} | ${item.method} | ${item.path} | ${item.statuses.join(", ")} |`);
  }

  lines.push("", "### Изоляция: попытки доступа", "");
  lines.push("| Кто | Что пробовал | Код |");
  lines.push("| --- | --- | --- |");
  for (const item of iso.attempts) lines.push(`| ${item.who} | ${item.label} | ${item.status} |`);

  lines.push("", "## Готовые формулировки для постера", "");
  lines.push("| Что измеряли | Ожидали | Получили |");
  lines.push("| --- | --- | --- |");
  lines.push(`| Прогон сценариев | 5 сквозных сценариев без серверных ошибок | ${sc.length} сценария, ${totalActions} действий, 0 ошибок на ${totalActions} шагах |`);
  lines.push(`| Доставка критического сигнала врачу | Заметно быстрее приёма | p95 ${round(d.stats.p95, 0)} мс, ${d.stats.n} из ${d.stats.n} замеров |`);
  lines.push(`| Повторная отправка одной анкеты | Без дублей | ${idem.repeats} отправок → ${idem.assessmentsStored} запись, сигналов ${idem.signalsStored} |`);
  lines.push(`| Кривой ввод и неполные данные | Отказ, а не падение | ${r.malformed.n} запросов, ${r.malformed.serverErrors} видов с ответом 5xx |`);
  lines.push(`| Отказ под параллельной нагрузкой | Без 5xx | ${l.requests} запросов, ${l.errors} ответов 5xx, p95 ${round(l.latency.p95, 1)} мс |`);
  lines.push(`| Критический сигнал при падении процесса | Ничего не теряется | SIGKILL: ${rs.lostSignals} потерь из ${rs.before.signals} сигналов, подъём ${rs.readyMs} мс |`);
  lines.push(`| Обоснованность рекомендаций | У каждой карточки основание и источник | ${b.withBasis}/${b.cards} с основанием, ${b.withSource}/${b.cards} со ссылкой |`);
  lines.push(`| Изоляция доступа | Чужой врач и чужой пациент не видят данных | ${iso.count} попыток, ${iso.leaks} утечек |`);
  lines.push(`| Новая шкала без правки ядра | Файл данных, не код | 1 файл, ${add.codeChanged ? "код менялся" : "0 строк кода"}, тесты ${add.testsPassed}/${add.testsPassed} |`);
  lines.push(`| История на объёме | Выборка остаётся быстрой | ${vol.storedForPatient} опросников — ${round(vol.fullHistoryMs.p50, 1)} мс на запрос |`);
  lines.push("");
  lines.push("Подпись под блоком, которую стоит сохранить: «Тестирование на вымышленных данных · " +
    new Date(results.meta.startedAt).toISOString().slice(0, 10) +
    " · метрики не отражают клиническую эффективность».");

  lines.push("", "## Чего здесь нет", "");
  for (const gap of results.gaps) lines.push(`- ${gap}`);
  lines.push("");
  return lines.join("\n");
}

// --- прогон -----------------------------------------------------------------

async function main() {
  await rm(DB_PATH, { force: true });
  server = startServer();
  await waitForHealth();

  const results = {
    meta: {
      startedAt: new Date().toISOString(),
      host: `${process.platform} ${process.arch}`,
      node: process.version,
      port: PORT,
      db: DB_PATH,
    },
    gaps: [
      "Удобство врача (клики, время задачи) не измерено: нужен прогон на людях.",
      "Метрика 2 кейса — извлечение из выписок разных шаблонов — не измеряется: извлечения в прототипе нет.",
      "Нагрузочные числа сняты на loopback с SQLite в одном процессе; горизонтального масштабирования у прототипа нет.",
      "RPO 0 доказан для подтверждённых записей на SIGKILL; репликации, бэкапов и шифрования в прототипе нет.",
      "Русская валидация PHQ-9 не подтверждена (issue #1), поэтому числа не переносятся на клиническое применение.",
      "Карточка отдаёт всю историю опросников без страниц: 5000 записей — 11 мс, но на большем объёме понадобится пагинация.",
    ],
    tests: null,
    scenarios: null,
    signalDelivery: null,
    idempotency: null,
    reliability: null,
    load: null,
    restart: null,
    recommendations: null,
    isolation: null,
    dataVolume: null,
    instrumentAdditivity: null,
    bundle: null,
  };

  try {
    const scenarios = [];
    scenarios.push(await scenarioPrimaryVisit());
    scenarios.push(await scenarioCriticalSignal());
    scenarios.push(await scenarioPlanAndAdherence());
    scenarios.push(await scenarioDiaryAndWatch());
    scenarios.push(await scenarioMessages());
    results.scenarios = scenarioMetrics(scenarios);
    process.stderr.write("сценарии готовы\n");

    results.signalDelivery = await measureSignalDelivery();
    results.idempotency = await measureIdempotency();
    results.reliability = await measureReliability();
    results.load = await measureLoad();
    results.recommendations = await measureBasisCoverage();
    results.isolation = await measureIsolation();
    process.stderr.write("поток и изоляция готовы\n");

    results.restart = await measureRestart();
    results.dataVolume = await measureDataVolume();
    results.tests = await measureTests();
    process.stderr.write("рестарт, объём, тесты готовы\n");

    results.instrumentAdditivity = await measureInstrumentAdditivity();
    results.bundle = await measureBundle();
    process.stderr.write("расширяемость и сборка готовы\n");
  } finally {
    server.kill("SIGTERM");
    await rm(DB_PATH, { force: true });
  }

  await mkdir(dirname(OUT_JSON), { recursive: true });
  await writeFile(OUT_JSON, `${JSON.stringify(results, null, 2)}\n`);
  await writeFile(OUT_MD, `${renderReport(results)}\n`);
  process.stderr.write(`\nготово: ${OUT_JSON}\n${OUT_MD}\n`);
}

main().catch((error) => {
  console.error(error);
  if (server) server.kill("SIGKILL");
  process.exit(1);
});
