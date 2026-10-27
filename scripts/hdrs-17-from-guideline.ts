/**
 * Пересобирает `server/instruments/hdrs-17.json` из приложения Г1 клинической
 * рекомендации (`docs/research/ai-decision-logic/sources/03-guideline-depression.md`).
 *
 * Пункты и варианты ответа берутся текстом источника, а не переписываются руками:
 * при извлечении заголовки обрезались на первой строке, и в шкале остались «Бессонница:
 * ранняя (трудности». Скрипт держит те же правила, что и проверка в engine.test.ts:
 * 17 пунктов, у девяти пунктов варианты 0–4, у восьми 0–2, последняя полоса кончается
 * максимумом шкалы.
 *
 * Запуск: `npx tsx scripts/hdrs-17-from-guideline.ts`
 */
import { readFileSync, writeFileSync } from "node:fs";

const SOURCE = "docs/research/ai-decision-logic/sources/03-guideline-depression.md";
const TARGET = "server/instruments/hdrs-17.json";

const START = "Приложение Г1. Шкала Гамильтона";
const END = "Приложение Г2.";
const OPTION = /^\s*(\d)\s*❑\s*(.*)$/;
const ITEM = /^\s*(\d{1,2})\.\s+(.+)$/;

/** Служебные слова бланка и колонка «Основание для оценки» — не текст пункта. */
function clean(text: string): string {
  return text
    .replace(/Основание для оценки/gi, " ")
    .replace(/…+/g, " ")
    .replace(/•/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:)])/g, "$1")
    .trim();
}

/** Заголовок пункта в источнике набран капслоком; в продукте он в обычном регистре. */
function sentenceCase(text: string): string {
  const lower = text.toLocaleLowerCase("ru-RU");
  return lower.charAt(0).toLocaleUpperCase("ru-RU") + lower.slice(1);
}

type Item = { id: string; text: string; options: { value: number; label: string }[] };

function parse(source: string): Item[] {
  const from = source.indexOf(START);
  const to = source.indexOf(END, from);
  if (from < 0 || to < 0) throw new Error("в источнике нет приложения Г1");

  const body = source.slice(from, source.indexOf("Сумма баллов:", from));
  const lines = body.split("\n");

  const items: Item[] = [];
  let nextNumber = 1;
  let current: Item | null = null;
  let option: { value: number; label: string } | null = null;
  let titleLines: string[] = [];
  let inTitle = false;

  for (const line of lines) {
    const itemMatch = ITEM.exec(line);
    // Новый пункт — только следующий по порядку: продолжения вариантов тоже начинаются с цифры.
    if (itemMatch && Number(itemMatch[1]) === nextNumber) {
      if (current) {
        if (option) current.options.push(option);
        if (inTitle) current.text = sentenceCase(clean(titleLines.join(" ")));
        items.push(current);
      }
      current = { id: `h${String(nextNumber).padStart(2, "0")}`, text: "", options: [] };
      nextNumber += 1;
      option = null;
      inTitle = true;
      titleLines = [itemMatch[2] ?? ""];
      continue;
    }
    if (!current) continue;

    const optionMatch = OPTION.exec(line);
    if (optionMatch) {
      if (inTitle) {
        current.text = sentenceCase(clean(titleLines.join(" ")));
        inTitle = false;
      }
      if (option) current.options.push(option);
      option = { value: Number(optionMatch[1]), label: clean(optionMatch[2] ?? "") };
      continue;
    }

    if (inTitle) titleLines.push(line);
    else if (option) option.label = clean(`${option.label} ${line}`);
  }
  if (current) {
    if (inTitle) current.text = sentenceCase(clean(titleLines.join(" ")));
    if (option) current.options.push(option);
    items.push(current);
  }

  return items;
}

/** Последняя полоса кончается максимумом шкалы, а не числом из старой выгрузки. */
function topScoreOf(items: Item[]): number {
  return items.reduce(
    (sum, item) => sum + Math.max(...item.options.map((option) => option.value)),
    0,
  );
}

function assertSourceShape(items: Item[]): void {
  if (items.length !== 17) throw new Error(`пунктов ${items.length}, а в шкале их 17`);

  const wide = items.filter((item) => item.options.length === 5).length;
  const narrow = items.filter((item) => item.options.length === 3).length;
  if (wide !== 9 || narrow !== 8) {
    throw new Error(`вариантов: ${wide} пунктов 0–4 и ${narrow} пунктов 0–2, а в источнике 9 и 8`);
  }

  for (const item of items) {
    item.options.forEach((option, index) => {
      if (option.value !== index) throw new Error(`пункт ${item.id}: варианты идут не по порядку`);
      if (option.label.length === 0) throw new Error(`пункт ${item.id}: пустой вариант ответа`);
    });
  }
}

const source = readFileSync(SOURCE, "utf8");
const items = parse(source);
assertSourceShape(items);

const instrument = JSON.parse(readFileSync(TARGET, "utf8")) as {
  items: Item[];
  bands: { id: string; min: number; max: number }[];
};
instrument.items = items;

const top = topScoreOf(items);
const last = instrument.bands.at(-1);
if (!last) throw new Error("у шкалы нет полос");
last.max = top;

writeFileSync(TARGET, `${JSON.stringify(instrument, null, 2)}\n`);
console.log(`hdrs-17: ${items.length} пунктов, максимум ${top}`);
