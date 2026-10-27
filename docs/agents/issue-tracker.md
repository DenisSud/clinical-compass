# Трекер задач: GitHub

Задачи и спецификации этого репозитория живут в GitHub Issues. Все операции — через `gh`.

## Соглашения

- **Создать задачу**: `gh issue create --title "..." --body "..."`. Для многострочного тела используйте heredoc.
- **Прочитать задачу**: `gh issue view <номер> --json number,title,body,labels,comments`.
- **Список задач**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` с нужными фильтрами `--label` и `--state`.
- **Сделать задачу подзадачей родительской**: `gh issue create --parent <родитель> ...` либо позже `gh issue edit <родитель> --add-sub-issue <подзадача>` (`gh` 2.94+). На старом `gh`: `gh api --method POST repos/<owner>/<repo>/issues/<родитель>/sub_issues -F sub_issue_id=<id-в-базе>` (идентификатор в базе, а не номер; см. **Блокировки**). Без подзадач в начале тела подзадачи напишите `Part of #<родитель>`.
- **Комментарий к задаче**: `gh issue comment <номер> --body "..."`
- **Поставить или снять метку**: `gh issue edit <номер> --add-label "..."` / `--remove-label "..."`
- **Закрыть**: `gh issue close <номер> --comment "..."`

Репозиторий выводится из `git remote -v`; внутри клона `gh` делает это сам.

## Pull requests как поверхность разбора

**Pull requests как запросы: нет.** _(Поставьте `да`, если репозиторий считает внешние PR заявками на функцию; `/triage` читает этот флаг.)_

Если стоит `да`, PR проходят те же метки и состояния, что задачи, через аналоги `gh pr`:

- **Прочитать PR**: `gh pr view <номер> --comments` и `gh pr diff <номер>` — диф.
- **Список внешних PR для разбора**: `gh api --paginate 'repos/{owner}/{repo}/pulls?state=open' --jq '.[] | select(.author_association | IN("OWNER","MEMBER","COLLABORATOR") | not) | {number, title, author: .user.login, author_association, labels: [.labels[].name]}'`.
- **Комментарий, метка, закрытие**: `gh pr comment`, `gh pr edit --add-label`/`--remove-label`, `gh pr close`.

GitHub делит одно пространство номеров между задачами и PR, поэтому голый `#42` может быть и тем и другим: проверьте `gh pr view 42` и при неудаче `gh issue view 42`.

## Когда навык просит «опубликовать в трекере»

Создайте задачу на GitHub.

## Когда навык просит «взять подходящий тикет»

Читайте его, как описано в разделе **Прочитать задачу**.

## Операции wayfinder

Используется в `/wayfinder`. **Карта** — одна задача с **дочерними** задачами вместо тикетов.

- **Карта**: одна задача с меткой `wayfinder:map`, в теле разделы «Заметки», «Решения», «Туман». `gh issue create --label wayfinder:map`.
- **Дочерний тикет**: задача, привязанная к карте как подзадача GitHub (см. **Сделать задачу подзадачей родительской**). Где подзадачи не включены, добавьте её в список задач в теле карты и напишите в начале тела `Part of #<карта>`. Метки: `wayfinder:<тип>` (`research`/`prototype`/`grilling`/`task`). После взятия задача назначается на ведущего разработчика.
- **Блокировки**: штатные зависимости задач GitHub — каноническое и видимое в интерфейсе представление. Ребро добавляется через `gh api --method POST repos/<owner>/<repo>/issues/<дочерняя>/dependencies/blocked_by -F issue_id=<id-блокера-в-базе>`, где `<id-блокера-в-базе>` — числовой **идентификатор в базе** (`gh api repos/<owner>/<repo>/issues/<n> --jq .id`), а не `#номер` и не `node_id`. GitHub отдаёт `issue_dependencies_summary.blocked_by` (только открытые блокеры, живой гейт). Где зависимостей нет, пишите в начале тела дочерней строку `Blocked by: #<n>, #<n>`. Тикет разблокирован, когда закрыты все блокеры.
- **Запрос фронта**: открытые дочерние задачи карты (`gh issue list --state open` в рамках подзадач карты или списка задач), отбросьте те, у кого есть открытый блокер (`issue_dependencies_summary.blocked_by > 0` или открытая задача в строке `Blocked by`) или исполнитель; первый по порядку карты побеждает.
- **Взятие**: `gh issue edit <n> --add-assignee @me` — первая запись сессии.
- **Решение**: `gh issue comment <n> --body "<ответ>"`, затем `gh issue close <n>`, затем добавьте указатель на контекст (gist и ссылку) в «Решения» карты.
