# clinical-compass

Clinical decision-support tool for physicians managing anxiety and depressive
symptoms. Case championship MVP, built slice by slice.

## Agent skills

### Issue tracker

Issues live in this repo's GitHub Issues, driven by the `gh` CLI. See
`docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary; label string equals role name. See
`docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` at the root plus ADRs in `docs/adr/`, created
lazily. See `docs/agents/domain.md`.

### Логика решений: площадка и тестер

Проверка логики идёт через `tools/logic-playground.ts` (`npm run play`), а не через
браузер и не глазами по скриншотам. Площадка импортирует настоящие модули —
`server/rules/registry`, `server/instruments/engine`, `server/prescriptions/schedule`,
поэтому показывает поведение продукта, а не его пересказ.

- **Площадка — часть проекта, не черновик.** Изменил пороги, шкалы или расписание —
  обнови площадку и её сценарии в том же коммите.
- **Случай, который нельзя выразить командой площадки, — дырка в площадке.**
  Добавь команду; «проверил руками» проверкой не считается.
- **Отказ продукта — часть поведения площадки.** Будущее время, пропуск без причины,
  неполный опросник: площадка отказывает так же, как маршрут, а не показывает
  состояние, которого продукт не создаёт.
- **Тестирует субагент `tester`** (`~/.pi/agent/agents/tester.md`): прогоняет площадку
  и тесты, ищет границы и пустые состояния, возвращает находки с воспроизведением.
  Код он не правит и тикеты не закрывает.
- **Находка становится тикетом.** Блокирующее — `bug` и в работу; остальное — в тикет
  с воспроизведением, чтобы не растворилось.

### Design

`DESIGN.md` at the root decides UI questions by citation (`DESIGN.md §3.2`).
Its §2 outranks any UX heuristic: clinical safety, uninterpreted patient data,
signal semantics above decoration. Read it before changing a screen.
