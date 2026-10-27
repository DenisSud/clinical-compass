import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { decisionQuestionSchema, type DecisionQuestion } from "../../shared/decisions.js";
import { assertBounds, assertTemplateNames } from "../rules/registry.js";

const DIRECTORY = join(import.meta.dirname, "..", "..", "content", "decisions");

/** A question file that does not meet the schema, or a template that names nothing. */
export class InvalidQuestion extends Error {}

/**
 * Schema first, then the rules' template check: a question is a rule with a wording,
 * so it inherits the guarantee that `{increase}` in the answer names a fact some
 * condition can produce. A typo fails at load, not as a 500 on the doctor's card.
 */
export function parseQuestion(value: unknown): DecisionQuestion {
  const parsed = decisionQuestionSchema.safeParse(value);
  if (!parsed.success) {
    const reason = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(корень)"}: ${issue.message}`)
      .join("; ");
    throw new InvalidQuestion(`вопрос не прошёл схему — ${reason}`);
  }

  // Тот же контроль подстановок, что у правил, но с семантикой «и»: `{increase}` в ответе
  // обязан называть факт, который умеет произвести хотя бы одно из условий, потому что
  // при ответе выполняются все.
  const label = `вопрос ${parsed.data.id}`;
  assertTemplateNames(label, [parsed.data.output.title, parsed.data.output.detail], parsed.data.when, "any");
  assertBounds({ id: parsed.data.id, when: parsed.data.when });
  return parsed.data;
}

/**
 * Reads every `*.json` in the directory. A broken file stops the load: a question that
 * silently stopped being asked is a decision the doctor believes is watched and is not.
 */
function loadQuestions(directory: string): DecisionQuestion[] {
  const questions: DecisionQuestion[] = [];
  const seen = new Set<string>();

  for (const file of readdirSync(directory).filter((name) => name.endsWith(".json")).sort()) {
    const question = parseQuestion(JSON.parse(readFileSync(join(directory, file), "utf8")));
    if (seen.has(question.id)) throw new InvalidQuestion(`вопрос ${question.id} объявлен дважды`);
    seen.add(question.id);
    questions.push(question);
  }

  return questions.sort((left, right) => left.id.localeCompare(right.id));
}

let cache: DecisionQuestion[] | null = null;

/** All questions, sorted by id so two runs answer in the same order. */
export function listQuestions(): DecisionQuestion[] {
  cache ??= loadQuestions(DIRECTORY);
  return cache;
}

/** The question behind a stored signal, or undefined once the file is gone. */
export function findQuestion(id: string): DecisionQuestion | undefined {
  return listQuestions().find((question) => question.id === id);
}

/** Test seam: drops the cache so a test can reload a directory it just wrote. */
export function resetQuestionsForTests(): void {
  cache = null;
}
