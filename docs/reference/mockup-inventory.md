# Инвентаризация mockup от Антона

Источник: `COMPASS_START.zip` (~/Downloads), распакован в `reference/mockup/`.
Стек: **Django 5.2**, SQLite (демо) / PostgreSQL, `waitress`. Рендеринг — серверный
шаблонизатор, без SPA.

Запуск: `START_DEMO.cmd` → `start_team_demo.py`. Логины: `doctor_demo` / `patient_demo`,
пароль `CompassDemo!2026`.

## Главный вывод

**В mockup нет ИИ вообще.** Это не забытая деталь — это явная позиция в коде:

```python
# care/knowledge.py
"""Local, unverified reference corpus. No generation, scoring or rule activation."""
```

```python
# care/assessments.py
"""Versioned PHQ-9 self-report for synthetic demo only; no diagnosis/treatment rules."""
```

Есть `ClinicalRuleVersion` (таблица для правил), но `status = "draft"` и ничего не
активирует. Есть `SourceDocument`/`KnowledgePassage` — корпус для RAG, но поиска и
генерации по нему нет.

То есть Антон собрал **клинический контур без мозга**: сбор данных, роли, аудит,
приватность. Кейс требует достроить мозг и не сломать контур.

## Что реально работает

### Модель данных (17 моделей)

| Сущность | Назначение | Оценка |
|---|---|---|
| `User` | `AbstractUser` + `role` (doctor/patient/operator) + `display_name`, UUID PK | Хорошо |
| `CareRelationship` | Связь врач-пациент, `is_active`, частичный unique-индекс «один активный врач» | **Очень хорошо** |
| `Invitation` | Одноразовый токен, хранится **хеш**, TTL 48 ч, отзыв | **Очень хорошо** |
| `SelfReport` | Дневник: `wellbeing` 1–10 + заметка + дата | Просто, но осмысленно |
| `ReportReview` | Отметка «врач посмотрел» | Хорошо |
| `SupportRequest` | Асинхронные обращения пациент→врач 3 категорий + ответ | Хорошо |
| `Assessment` | Пройденный опросник: снимок определения + хеш + ответы + балл | **Отлично** |
| `AssessmentReview` / `AssessmentAttention` | Просмотр врачом / «требует разбора» | Хорошо |
| `SourceDocument` | Источник: версия, sha256, тип, применимость, **usage_rights**, `review_status` | **Отлично** |
| `KnowledgeSnapshot` | Импортированный текст + хеши | Хорошо |
| `KnowledgePassage` | Фрагмент с `start`/`end` в тексте + sha256 (для точной цитаты) | **Отлично** |
| `ClinicalRuleVersion` | Версия правила + `specification` JSON + `status` | Заготовка, не используется |
| `AuditEvent` | Append-only: `update()`/`delete()` бросают `TypeError` | **Отлично** |

### Что сделано по-настоящему хорошо (не переписывать)

1. **Audit log append-only на уровне ORM.** `AppendOnlyQuerySet.update/delete` →
   `TypeError`. Плюс `save()` запрещает изменение существующей записи. Плюс комментарий
   «ID/статусы only, никогда не сырой текст самоотчёта, токены, пароли». Это ровно то, что
   просят в «защищённости данных» (метрика 13).
2. **Идемпотентность записи.** `submission_key` (UUID) на каждой пациентской отправке +
   обработка `IntegrityError` + проверка «повтор с теми же данными → вернуть существующую,
   с другими → ошибка». Это защита от двойного тапа и от подмены. Редко кто делает.
3. **Версионирование определения шкалы.** `Assessment` хранит `definition` целиком,
   `definition_sha256`, `instrument_version`. Форма подписана `signing.dumps` — при смене
   версии старая форма отвергается. Правильная архитектура, и она уже есть.
4. **Неполные ответы ≠ ноль.** `completed_count` + `total = None` если не все 9 ответов.
5. **Имутабельность связи.** `end_relationship` отказывает, пока есть неотвеченные
   обращения или непринятые attention.
6. **Разделение ролей на уровне сервисов.** `require_role(user, role)` в каждом методе.
7. **`PrivateResponseMiddleware`** — заголовки no-store/cache для приватности.

### Что не сделано

| Область | Состояние |
|---|---|
| **ИИ / RAG** | Полностью отсутствует |
| **Правила** | `ClinicalRuleVersion` есть, движка нет |
| **Алертинг** | Только `AssessmentAttention` (q9>0). Нет доставки, нет приоритетов, нет «обязательно/желательно» |
| **Авиандр** | Нет вообще. Нет препаратов, нет назначений, нет плана лечения (`План лечения ещё не добавлен`) |
| **Маршрутизация** | Нет |
| **Приверженность** | Нет (функция 7 кейса) |
| **Шкалы** | Только PHQ-9. HADS, C-SSRS, HCL-33 отсутствуют |
| **Динамика** | График есть (`chart.html`), но только по `wellbeing` |
| **Ветвление шкал** | Модель `items[]` линейная — C-SSRS так не выразить |
| **Извлечение из выписок** | `document_reader.py` только читает приложенные страницы PDF, парсинга нет |
| **Психиатр как роль** | Нет |

## Маршруты (весь объём)

```
Пациент:  /patient/  /patient/connect/  /patient/report/  /patient/request/
          /patient/assessment/phq9/  /assessments/<id>/
Врач:     /doctor/  /doctor/patients/<id>/  /doctor/invitations/
          /doctor/sources/  /doctor/sources/<id>/  /doctor/audit/
          /doctor/assessments/<id>/review|acknowledge/
Прочее:   /login/  /logout/  /health/
```

30 маршрутов, ~19k строк в `views.py` (файл 19 KB). Всё серверное, без API.

## Оценка объёма

- `views.py` 19 KB, `models.py` 14 KB, `services.py` 9 KB, `knowledge.py` 7 KB,
  `assessments.py` 7 KB.
- 14 шаблонов, 24 KB CSS. Дизайн аккуратный, русскоязычный, с нормальной иерархией
  (attention-панели выделены).

## Рекомендация

Брать mockup **как скелет и как эталон приватности**, не переписывать с нуля. Добавлять:

1. `pharmacology` — препараты, инструкции, правила противопоказаний/взаимодействий.
2. `rules` — движок правил (данные, не код) + алертинг с доставкой.
3. `assistant` — RAG и генерация черновиков, всегда со ссылкой на фрагмент.
4. Расширить `instruments` — HADS, C-SSRS (ветвление), HCL-33.
5. `routing` — маршрутизация «обязательно/желательно» к психиатру.
6. `adherence` — приверженность.

## Что нужно от Антона

- [ ] Подтвердить, что `reference/mockup/` — актуальная версия, и продолжать в ней.
- [ ] Выгрузить `file.pdf` (рекомендации по депрессии с HAM-D / HCL-33 / C-SSRS).
- [ ] Пояснить, почему `knowledge_assets/` (30 МБ отрендеренных страниц PDF) исключены из
      репозитория — они пересоздаются командой `import_knowledge`.
