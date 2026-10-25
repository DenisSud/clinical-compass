---
issue: 18
title: "Лицензии и русская валидация шкал: PHQ-9, HADS, BDI, C-SSRS"
type: research
status: findings
date: 2026-10-25
method_note: >
  Цитаты взяты из сниппетов поисковой выдачи, указывающих на страницу первоисточника;
  полные страницы не открывались (в сессии субагента не было загрузки страниц). Всё, что
  требует чтения полного текста, помечено в разделе «Что осталось непроверенным».
целевой_путь_в_репозитории: docs/research/ai-decision-logic/research/scale-licenses.md
---

# Лицензии и русская валидация шкал: PHQ-9, HADS, BDI, C-SSRS

## Как читать этот файл

Каждое утверждение помечено одним из трёх:

- **[прямое]** — цитата из первоисточника (сайт правообладателя, текст лицензии, официальный документ).
- **[интерпретация]** — что из цитаты следует, если прочитать её буквально.
- **[вывод]** — моё умозаключение, которого в источнике нет.

**Ограничение метода, которое надо знать до чтения.** В этой сессии у меня был только поиск и запись файлов: ни загрузки страниц, ни оболочки. Поэтому все цитаты ниже — из **сниппетов поисковой выдачи, указывающих на страницу первоисточника**, а не из прочитанного полного текста страницы. Для булевых формулировок (есть/нет разрешения, кому выдаётся лицензия) сниппет обычно воспроизводит нужную фразу дословно, и я привожу её как есть. Но это на шаг слабее чтения страницы, и там, где сниппет обрывается на полуслове, я это явно отмечаю. Три вещи, которые нельзя считать проверенными без открытия страниц руками, перечислены в разделе «Что осталось непроверенным».

---

## Что искал

1. **Правообладатель и точные условия переиспользования** для каждого из четырёх инструментов: заявление самого правообладателя (Pfizer для PHQ-9, GL Assessment / Mapi Research Trust для HADS, Pearson для BDI, Columbia Lighthouse Project / Research Foundation for Mental Hygiene для C-SSRS).
2. **Различие режимов**: исследование/демо, клинический пилот, коммерческий продукт.
3. **Библиографический источник русской валидированной версии** — авторы, год, журнал.
4. **Бланк PHQ-9 с брендингом НКО «Ясное утро»** — что там написано и что из этого следует для перерисовки без логотипа.

Дополнительно, поскольку это всплыло по ходу: воспроизводится ли русский текст шкал в **официальных российских клинических рекомендациях** (одобренных Минздравом), потому что это единственный найденный «официальный» источник русских формулировок для трёх из четырёх инструментов.

---

## Находки

### 1. PHQ-9

**1.1. Правообладатель и формулировка разрешения.**
**[прямое]** На самих бланках PHQ-9 стоит формула: «Developed by Drs. Robert L. Spitzer, Janet B.W. Williams, Kurt Kroenke and colleagues, with an educational grant from Pfizer Inc. No permission required to reproduce, translate, display or distribute.» Та же строка процитирована в карточке инструмента в базе NIH/NLM Common Data Elements: «No permission required to reproduce, translate, display or distribute.»
Источники: <https://cde.nlm.nih.gov/formView?tinyId=myG8MkTbwg>; пример бланка с той же строкой — <https://premierpediatricscoastal.com/wp-content/uploads/2026/10/PHQ-9-English.pdf>.
**Поддержка:** прямое доказательство (дословная формула, воспроизведённая в нескольких независимых местах).
**Уверенность:** высокая в отношении формулировки; средняя в отношении того, что Pfizer не менял позицию позже (см. п. 5.1).

**1.2. Что из этой формулы следует.**
**[интерпретация]** Разрешение не оговорено ни типом пользователя, ни целью, ни коммерческим характером: запрещено только то, чего в тексте нет. «Reproduce, translate, display, distribute» покрывает и печать бланка, и показ пунктов на экране, и перевод. Отдельного «коммерческого» разрешения или отдельной коммерческой лицензии я не нашёл.
**[вывод]** Для продукта, который показывает пациенту девять пунктов и четыре варианта ответа (а именно это требует `DESIGN.md` §3.3 и §4 — «четыре градации это инструмент», «девять пунктов PHQ-9 не дробятся»), лицензия по букве формулы не нужна. Единственное, что формула не обсуждает, — **сохранение кредита авторов**; она его не требует явно, но и не отменяет.

**1.3. Русская валидация — найдена.**
**[прямое]** Говоров С.А., Пантелеева О.И., Олейчик М.И., Шевченко О.П. «Русскоязычная версия PHQ-9: пилотажная оценка надёжности, валидности и факторной структуры в клинической выборке» // Новые психологические исследования. 2026. № 1, ст. 10 (URL-слаг `ru-2026-1-10`).
Источники: <https://newpsyresearches.ru/article/govorov-panteleeva-oleychik-shevchenko-ru-2026-1-10>; PDF: <https://newpsyresearches.ru/storage/RRAgVoIMM5MZR40JWp2miTRSdIUic7RPqWUlLwMm.pdf>; библиографическая запись продублирована в ИСТИНА (<https://istina.ips.ac.ru/journals/367210144/>) и на PsyJournals (<https://psyjournals.ru/authors/11911>).
**[прямое]** Вывод статьи в сниппете: «русскоязычная версия PHQ-9 является надёжным и валидным инструментом для скрининга депрессии у пациентов с непсихотическими расстройствами».
**[интерпретация]** Слово «пилотажная» в заголовке — существенно: это не нормативная валидация на большой популяции, и ссылаться на неё как на «русские нормы» нельзя. Авторы — НЦПЗ (Научный центр психического здоровья), выборка клиническая.
**Уверенность:** высокая в существовании публикации; средняя в деталях (выборка, пороги, психометрика) — я видел только заголовок, вывод и библиографическую запись.

**1.4. Русский текст PHQ-9 опубликован в официальных клинических рекомендациях.**
**[прямое]** «ОПРОСНИК ПО СОСТОЯНИЮ ЗДОРОВЬЯ-9 (PHQ-9)» — Приложение Г4 к Клиническим рекомендациям «Кистозный фиброз (муковисцидоз)» (одобрены Минздравом России), с кредитом «Разработано докторами…» и ссылкой на Kroenke K. et al. The PHQ-9: validity of a brief depression severity measure. J Gen Intern Med. 2001;16(9):606–13.
Источник: <https://www.consultant.ru/document/cons_doc_LAW_521021/16b4928f8a4fb43db7d6bfbdd41c9eddd0561835/>.
PHQ-9 также входит Приложением Г10 в клинреки «Старческая астения» (<https://sudact.ru/law/klinicheskie-rekomendatsii-starcheskaia-asteniia-utv-minzdravom-rossii_1/prilozhenie-g/prilozhenie-g10/>).
**Уверенность:** высокая (сниппет содержит заголовок приложения и его принадлежность к документу).

**1.5. Бланк с брендингом «Ясного утра» — что удалось установить.**
**[прямое]** Файл существует и принадлежит службе: <https://yasnoeutro.ru/wp-content/uploads/PHQ9.pdf>. Сниппет показывает содержимое: «Опросник для самодиагностики депрессии пациента (PHQ-9)… Для врача. Если пациент набрал больше 1 балла, попросите его оценить…», а в подвале — «СЛУЖБА «ЯСНОЕ УТРО» ВСЕРОССИЙСКАЯ ГОРЯЧАЯ ЛИНИЯ ДЛЯ ОНКОПАЦИЕНТОВ И ИХ БЛИЗКИХ 8-800-100-0191 ЯСНОЕУТРО.РФ. Опросник не предназначен для постановки точного диагноза. Необходима консультация со специалистом. Разработано …»
**Что это значит [интерпретация]:** бланк = стандартный PHQ-9 с добавленной обвязкой службы (логотип, телефон, домен, дисклеймер). Фраза обрывается на слове «Разработано», и **чем она кончается — кредитом Спитцера/Кронке или словами «Разработано службой „Ясное утро“» — из сниппета установить нельзя.** Это ровно тот вопрос, на который отвечает открытие PDF руками, и я его не закрыл.
**Организация [прямое]:** «Ясное утро» — служба АНО «Проект СО-действие», создана в июле 2007 года, профиль — психологическая помощь онкологическим больным и их близким (<https://dobro.ru/projects/7796>, <https://asi.org.ru/ngoprofile/proekt-so-dejstvie/>). Признаков того, что организация заявляет права на шкалу, я не нашёл.
**[вывод]** По букве формулы Pfizer перерисовка бланка без логотипа, телефона и домена НКО ничем не ограничена — ограничение пришло бы от прав на бренд НКО, а не от прав на PHQ-9. Юридический вывод — за юристом; см. «Вопросы к юристу» ниже.

### 2. HADS

**2.1. Правообладатель и механизм лицензирования.**
**[прямое]** HADS распространяется через Mapi Research Trust (платформа ePROVIDE) как «Official Hospital Anxiety and Depression Scale (HADS) by Snaith RP, distributed by Mapi Research Trust», там же собраны сведения о copyright, licensing и translations: <https://eprovide.mapi-trust.org/instruments/hospital-anxiety-and-depression-scale>. Правообладатель — GL Assessment (группа GL Education); у Mapi Research Trust есть отдельный анонс партнёрства по линейке GL Education (HADS, GHQ): <https://www.mapi-trust.org/news-events/news/partnership-between-mapi>.
**[прямое]** Пользовательское лицензионное соглашение ePROVIDE: «In consideration for the License granted under this Agreement, the User agrees to pay the Licensing Fee, if applicable, specified in the Special Terms. The amount of the Licensing Fee is determined based on the information given by the User in the Special terms.» (<https://eprovide.mapi-trust.org/page/user-agreement-general-terms>).
**[интерпретация]** Механизм — не «свободное использование», а **лицензия на исследование/применение с индивидуальными условиями и возможной платой**, определяемой по анкете пользователя. Кто именно и сколько платит — из открытых страниц не видно, это решается в Special Terms.
**Уверенность:** высокая в отношении механизма; низкая в отношении размера и наличия платы для конкретного нашего случая.

**2.2. Плата для всех пользователей, включая академических — но из вторичного источника.**
**[прямое, но вторичное]** Таблица разрешений Crohn's & Colitis Foundation: «Copyright/permission: The use of the HADS is licensed by GL Assessment. A license agreement must be completed and a User fee is required to all users (commercial & academic users).» (<https://www.crohnscolitisfoundation.org/sites/default/files/legacy/science-and-professionals/programs-materials/ibd-nurses/best-practices/ibd-patient-intake-data-sheet-2.pdf>).
**[прямое, но вторичное]** Статья в PMC: «The use of this scale has been licensed by GL Assessment, MAPI Research Trust, and is available from GL Assessment» (<https://pmc.ncbi.nlm.nih.gov/articles/PMC11382484/>).
**Уверенность:** средняя. Это добросовестные третьи стороны, но не GL Assessment; их формулировка «user fee … to all users» может быть их собственным пересказом условий. **Собственной страницы GL Assessment с текстом условий я не получил** — поиск по «GL Assessment» стабильно разваливался на токене «GL».

**2.3. Русская валидация — не найдена.**
**[прямое]** Русский текст HADS циркулирует с атрибуциями «адаптация Бевз, 1999» (<https://psytests.org/depr/hads-run.html>) и «адаптация Кукшина и др., 2013» (вариант HADS/НДФ, <https://psytests.org/depr/hadsdf.html>). **Ни в одном найденном источнике нет названия журнала, тома и страниц.** Это атрибуция без библиографии.
**[прямое]** При этом русский текст HADS опубликован приложениями в клинических рекомендациях Минздрава: «Когнитивные расстройства у лиц пожилого и старческого возраста», Приложение Г26 (<https://www.consultant.ru/document/cons_doc_LAW_488514/ff601eb9f4ebef97409691190c7ec303f7f13e4d/>); «Эпилепсия и эпилептический статус у взрослых и детей», Приложение Г3 (<https://www.consultant.ru/document/cons_doc_LAW_424695/b75fa5c631c5b2e5a9d33c7ea72426d4b2f7979e/>); «ВИЧ-инфекция у детей» (<https://www.consultant.ru/document/cons_doc_LAW_373980/0ac9bdcb25e0e448b9ee67db3cb77c6f0ad6f839/>). В приложении указан первоисточник: «Zigmond A.S., Snaith R.P. 1983».
**Уверенность:** высокая в том, что публикации о валидации я не нашёл; **это не доказательство, что её нет** (см. «Что осталось непроверенным»).

### 3. BDI (Beck Depression Inventory)

**3.1. Правообладатель и режим.**
**[прямое]** BDI-II — Beck Depression Inventory®-Second Edition, авторы Aaron T. Beck, Robert A. Steer, Gregory K. Brown; продаётся Pearson как коммерческий продукт с квалификационными уровнями доступа (Qualification Level B) и подписками на скоринг: <https://www.pearsonassessments.com/en-us/Store/Professional-Assessments/Personality-%26-Biopsychosocial/Beck-Depression-Inventory/p/100000159>, <https://www.pearsonclinical.ca/en-ca/Store/Professional-Assessments/Personality-%26-Biopsychosocial/Brief/Beck-Depression-Inventory-II/p/P100008037?productId=QG1BDI>. Карточка с описанием copyright/licensing есть и на ePROVIDE: <https://eprovide.mapi-trust.org/instruments/beck-depression-inventory-r-second-edition>.
**[прямое]** Политика Pearson по воспроизведению: «Reproduction of any purchased materials requires the prior written consent of Pearson. Questions and answers … may not be reproduced without written permission, regardless of the number of lines or items involved» (<https://www.pearsonclinical.in/legal/permissions-and-licensing.html>). Австралийское подразделение формулирует жёстче: «In Pearson's view, reproduction of its test materials without prior written consent DOES NOT fall within the "fair use" exception of the copyright law» (<https://www.pearsonclinical.com.au/legal/legal-policies.html>).
**[прямое]** Раздельные лицензионные треки: «Research License Requests (for permission to use assessments for research by non-pharmaceutical companies)», «Pharmaceutical…» (<https://pearson.my.site.com/usclinical/s/article/Legal-Assistance-Requests>, <https://www.pearsonassessments.com/footer/permissions---licensing.html>).
**[прямое]** Телеметрия/онлайн: «You may use the BDI-II via telehealth without additional permission from Pearson in the following published context: BDI-II On-Screen Administration (OSA) or Remote On-Screen Administration (ROSA) via Q-global … Any other use of the BDI-II via telehealth requires prior permission from Pearson» (<https://www.pearsonclinical.asia/digital-solutions/telehealth/telehealth-and-the-bdi_ii.html>).
**[интерпретация]** BDI — противоположность PHQ-9: воспроизведение пунктов и скоринг в собственном продукте прямо требует письменного согласия, а «мы небольшой некоммерческий проект» не является аргументом в формулировке Pearson. Разрешённый цифровой путь — не «своя форма», а их собственные OSA/ROSA-каналы через Q-global.
**Уверенность:** высокая в отношении политики Pearson; неизвестно, действует ли она в отношении продаж в РФ (см. п. 5.2).

**3.2. Русская валидация BDI-II — не найдена.**
**[прямое]** Русская BDI (21 группа утверждений) циркулирует с атрибуцией «Aaron Beck, 1961; адаптация Тарабрина, 1992» (<https://psytests.org/depr/bdi-blF.html>). Библиографической ссылки (журнал, год, том, страницы) ни в одном найденном источнике нет.
**[прямое]** Русский текст «ШКАЛА ДЕПРЕССИИ БЕКА» опубликован как Приложение Г5 к клиническим рекомендациям «Коронавирусная инфекция COVID-19» (одобрены Минздравом России): <https://www.consultant.ru/document/cons_doc_LAW_525432/b6c8650b8ebe4cce1815aae5c470817ea8bdbaa0/>.
**[интерпретация]** Какая именно версия (BDI 1961 / BDI-IA 1978 / BDI-II 1996) воспроизведена в приложении Г5 — из сниппета не определить. Для лицензионного анализа это критично: у версий разные правообладатели-издатели и разные сроки охраны.
**Уверенность:** средняя в факте публикации приложения; низкая в идентификации версии.

### 4. C-SSRS

**4.1. Правообладатель — фонд, а не Колумбийский университет.**
**[прямое]** «The Research Foundation for Mental Hygiene Inc., the parent organization of The Columbia Lighthouse Project, holds the C-SSRS copyright» (<https://cssrs.columbia.edu/pharmaceutical-funded-research/>).
**[прямое]** В лицензионном шаблоне Clario: «© 2008 Research Foundation for Mental Hygiene, Inc.» (<https://clario.com/wp-content/uploads/2024/06/ERT-Template-C-SSRS-License-Agreement_JUN2024_final.docx>).
**Уверенность:** высокая.

**4.2. Что бесплатно, а что нет.**
**[прямое]** «Free. The protocol and the training on how to use it are available free of charge for use in community and healthcare settings, as well as in federally funded or nonprofit research. For health/behavioral health care providers there is also no cost or license required to put the Columbia Protocol tools into your EHR/EMR» (<https://cssrs.columbia.edu/the-columbia-scale-c-ssrs/healthcare/>). Та же формулировка на сайте Columbia Psychiatry: «Free - The scale and the training … available free of charge for use in community and healthcare settings, as well as in federally funded or nonprofit research» (<https://www.columbiapsychiatry.org/research-labs/columbia-suicide-severity-rating-scale-c-ssrs>).
**[прямое]** Для исследований, финансируемых фармой, — отдельный режим: «The Project has a separate webpage with specific information about the use of the Columbia Protocol in research funded by pharmaceutical companies (including licensing requirements)» (<https://cssrs.columbia.edu/the-columbia-scale-c-ssrs/cssrs-for-research/>); отдельная страница: <https://cssrs.columbia.edu/pharmaceutical-funded-research/>.
**[прямое]** Электронные реализации лицензируются отдельно и эксклюзивно: «eResearch Technology, Inc., a Clario company ("Clario") has entered into an exclusive license agreement for the electronic implementations of this scale with the Research Foundation for Mental Hygiene, Inc. (RFMH) who controls the copyright for the scale» (<https://clario.com/about/legal-and-privacy/c-ssrs-licensing-application/>).
**[прямое]** Условия шаблона лицензии Clario: «(d) Allowable platforms include: tablet or web only»; предусмотрен «Certification Process» — «ERT will provide Licensee with a reference document on which Licensee can base its electronic implementation of the Scale» (<https://clario.com/wp-content/uploads/2024/06/ERT-Template-C-SSRS-License-Agreement_JUN2024_final.docx>).
**[интерпретация]** Бесплатность C-SSRS ограничена **некоммерческим клиническим применением и некоммерческими исследованиями**. Наше приложение — это (а) электронная реализация и (б) в перспективе коммерческий продукт; обе характеристики выводят его из «free»-режима и попадают в зону, где правами распоряжается RFMH и где эксклюзив на электронные реализации у Clario.
**Уверенность:** высокая в отношении текстов; **средняя** в отношении того, как это применяется к российскому коммерческому продукту, который не является ни клиническим исследованием, ни EHR американской клиники. Прямого ответа «нужна ли лицензия российскому коммерческому приложению» в найденных текстах нет — это главный пробел (см. п. 5.4).

**4.3. Русская валидация C-SSRS — не найдена.**
**[прямое]** Русский текст C-SSRS опубликован в клинических рекомендациях: «Депрессивный эпизод, Рекуррентное депрессивное расстройство», Приложение Г4 — с блоком «Название на русском языке: Колумбийская шкала серьёзности суицидальных намерений. Оригинальное название: Columbia Suicide Severity Rating Scale (C-SSRS). Источник: Posner …» (<https://sudact.ru/law/klinicheskie-rekomendatsii-depressivnyi-epizod-rekurrentnoe-depressivnoe-rasstroistvo/prilozhenie-g1-gn/prilozhenie-g4/>, зеркало в Гаранте: <https://base.garant.ru/409578883/7cbea0c4512ce29f121ee28b85ff067b/>). Также приложение Г1 в клинреках «Биполярное аффективное расстройство» (<https://www.consultant.ru/document/cons_doc_LAW_503151/5aaa499f8f665b6ea1a5d31d29129b9623d62eec/>).
**[прямое]** Публикации о психометрической валидации русской версии C-SSRS я не нашёл; циркулируют неакадемические пересказы (<https://psylab.info/…, https://statblank.com/…), ссылающиеся на оригинал Posner 2011 (Am J Psychiatry. 2011;168(12):1266–77 — библиография подтверждена карточкой ePROVIDE: <https://eprovide.mapi-trust.org/instruments/columbia-suicide-severity-rating-scale>).
**Уверенность:** средняя (отсутствие находки ≠ отсутствие работы).

### 5. Сводные оговорки

**5.1.** Формулу «No permission required…» я видел на множестве бланков и в базе NLM, но **не на сайте Pfizer**. Действует ли она в неизменном виде сейчас и не отозвана ли — не проверено.

**5.2.** Продаёт ли Pearson свои инструменты в РФ и действует ли его политика в отношении российских пользователей — не проверено. Это может оказаться решающим для BDI: если лицензию физически нельзя получить, инструмент недоступен, а не «дорог».

**5.3.** Ни для HADS, ни для BDI, ни для C-SSRS я не нашёл русской валидационной публикации с полной библиографией. Для PHQ-9 нашёл. Это **асимметрия, которая важнее лицензий**: лицензию можно купить, а валидацию нельзя.

**5.4.** Для коммерческого электронного продукта вне США прямой ответ RFMH/Columbia не найден. Косвенно: электронные реализации — отдельный лицензионный канал Clario; клиническое применение бесплатно. Где между этими двумя точками находится наше приложение — вопрос к правообладателю, а не к поиску.

### Вопросы к юристу (не мои выводы)

- Является ли воспроизведение русского текста шкалы из приложения к клиническим рекомендациям Минздрава законным основанием, если клинреки — официальный документ? П. 6 ст. 1259 ГК РФ исключает официальные документы государственных органов из объектов авторских прав, но применимо ли это к клиническим рекомендациям (они «одобрены Минздравом», а не являются нормативным актом) — я не проверял дословно и не решаю.
- Охраняется ли конкретный русский перевод шкалы как производное произведение (ст. 1260 ГК РФ), даже если правообладатель оригинала разрешил перевод без разрешения.
- Есть ли у АНО «Проект СО-действие» («Ясное утро») какие-либо права на бланк, кроме прав на собственный товарный знак и логотип.

---

## Что осталось непроверенным

1. **Содержание PDF «Ясного утра» после слова «Разработано»** — кредит авторов или подпись службы. Сниппет обрывается. Что пробовал: запросы по точному домену с фрагментами подвала (`yasnoeutro PHQ9 разработано докторами Спитцером Кронке разрешения`, `ясноутро PHQ9 не требуется разрешения воспроизведение перевод распространение`); выдало сам PDF и русские перепечатки формулы у третьих лиц, но не хвост строки.
2. **Собственная страница GL Assessment с условиями HADS.** Что пробовал: 6+ формулировок запроса; поиск стабильно схлопывал «GL» в автодилеров и язык программирования. Условия восстановлены по ePROVIDE и двум вторичным источникам.
3. **Русские валидационные публикации HADS, BDI и C-SSRS.** Что пробовал: десятки запросов на русском (включая фамилии Бевз, Кукшина, Тарабрина, Дробижев, Андрющенко) и на английском. Поисковый движок в этой сессии на длинных русских запросах деградировал до словарных статей («валидация — это…», «адаптация — это…»), поэтому отрицательный результат здесь слабый. **Нужен ручной проход по eLibrary / «Российскому психиатрическому журналу» / «Неврологическому вестнику» / «Обозрению психиатрии и медицинской психологии».**
4. **Действующий статус формулы Pfizer** и продажи Pearson в РФ (пп. 5.1–5.2).

---

## Что это меняет для правил

- **Правило «показываем полный текст PHQ-9 и считаем сумму» — единственное, что не упирается в лицензию.** Формула Pfizer разрешает reproduce/translate/display/distribute без разрешения и без разделения на коммерческое и некоммерческое. Это снимает лицензионный блок с самого тяжёлого экрана продукта (`DESIGN.md` §3.3, §4).
- **Правило «PHQ-9 ≥ 10 → сигнал» можно писать, но со ссылкой на пилотаж, а не на нормы.** Русская валидация существует ровно одна и она «пилотажная оценка» (Говоров и др., 2026). Формулировка правила обязана это отражать; «валидированный русский порог» — неправда.
- **Правила на HADS и BDI в MVP становятся невозможны, а не «отложены».** Обе шкалы требуют лицензии и оплаты для любого пользователя, включая академического (HADS — по вторичным источникам, BDI — по собственной политике Pearson, которая прямо отвергает fair use). Русский текст в клинреках наличия лицензии не создаёт.
- **Правило «встраиваем C-SSRS-скрининг в приложение» нельзя включать до ответа правообладателя.** Бесплатный режим покрывает клиническое применение и некоммерческие исследования; электронные реализации — отдельный эксклюзивный канал (Clario/RFMH), планшеты и веб, с сертификацией. Наше приложение — электронная реализация коммерческого продукта, то есть худшая из неопределённых позиций.
- **Правило «русская норма» для HADS, BDI, C-SSRS не может существовать**, пока нет публикации: нашлась только атрибуция «адаптация Бевз, 1999» / «адаптация Тарабрина, 1992» без журнала и страниц. Правило, которое ссылается на «адаптацию», будет ссылаться в пустоту.
- **Правило «бланк без логотипа НКО» разблокировано, но не благодаря НКО.** Ограничение на перерисовку пришло бы от прав на бренд «Ясного утра», а не от прав на PHQ-9; при этом кредит авторов в бланке надо сохранить — и именно его наличие в исходном PDF пока не подтверждено (п. 1.5).

---

## Источники

### Оставлены

- **NLM Common Data Elements, PHQ-9** (<https://cde.nlm.nih.gov/formView?tinyId=myG8MkTbwg>) — государственная база NIH, воспроизводит формулу разрешения дословно.
- **Columbia Lighthouse Project, Healthcare** (<https://cssrs.columbia.edu/the-columbia-scale-c-ssrs/healthcare/>) — собственный текст правообладателя о бесплатном режиме и EHR/EMR.
- **Columbia Lighthouse Project, Pharmaceutical-Funded Research** (<https://cssrs.columbia.edu/pharmaceutical-funded-research/>) — держатель копирайта (RFMH) и отдельный режим для фарма-исследований.
- **Clario, C-SSRS licensing + шаблон лицензии** (<https://clario.com/about/legal-and-privacy/c-ssrs-licensing-application/>, <https://clario.com/wp-content/uploads/2024/06/ERT-Template-C-SSRS-License-Agreement_JUN2024_final.docx>) — единственный найденный первичный текст условий для электронных реализаций.
- **Pearson Clinical, Permissions & Licensing** и политики подразделений (<https://www.pearsonassessments.com/footer/permissions---licensing.html>, <https://www.pearsonclinical.com.au/legal/legal-policies.html>, <https://pearson.my.site.com/usclinical/s/article/Legal-Assistance-Requests>) — прямое «нет» на fair use и раздельные треки research/pharma.
- **Pearson, BDI-II telehealth** (<https://www.pearsonclinical.asia/digital-solutions/telehealth/telehealth-and-the-bdi_ii.html>) — что именно разрешено в цифре без отдельного разрешения.
- **ePROVIDE: HADS, BDI-II, C-SSRS + User License Agreement General Terms** (<https://eprovide.mapi-trust.org/instruments/hospital-anxiety-and-depression-scale>, <https://eprovide.mapi-trust.org/page/user-agreement-general-terms>) — механизм лицензии с Licensing Fee.
- **Mapi Research Trust × GL Education** (<https://www.mapi-trust.org/news-events/news/partnership-between-mapi>) — связь HADS с GL Education.
- **Говоров и др., 2026, «Новые психологические исследования»** (<https://newpsyresearches.ru/article/govorov-panteleeva-oleychik-shevchenko-ru-2026-1-10>) — единственная найденная русская валидация PHQ-9.
- **КонсультантПлюс, приложения клинрекомендаций** (PHQ-9 — `cons_doc_LAW_521021`; HADS — `cons_doc_LAW_488514`, `_424695`, `_373980`; BDI — `cons_doc_LAW_525432`; C-SSRS — `cons_doc_LAW_503151`) — официальные русские тексты и указанные в них первоисточники.
- **sudact / Гарант, клинреки «Депрессивный эпизод» Приложение Г4** — русский C-SSRS с блоком «Источник: Posner…».
- **yasnoeutro.ru/…/PHQ9.pdf** — сам спорный бланк.

### Отклонены или понижены

- **psytests.org** — полезен как указатель («адаптация Бевз, 1999», «адаптация Тарабрина, 1992»), но библиографии не даёт; для утверждений о валидации не годится.
- **statblank.com, calcal.ru, shkala-beka.ru, endoclera.com, prismatest.com** — SEO-сайты тестов; годились только чтобы увидеть, как формула Pfizer переведена на русский, не как доказательство.
- **healthiness360.com, arabpsychology.com, clinicaltoolslibrary.com** — пересказы про «permissions & fee» без ссылок на первоисточник.
- **ru.wikipedia.org / psylab.info** — для истории шкал, не для прав и не для валидации.
- **Клиники и медцентры, попадавшие в выдачу по слову «Hospital»** — шум.

---

## Следующие шаги

1. Открыть `https://yasnoeutro.ru/wp-content/uploads/PHQ9.pdf` руками и прочитать строку после «Разработано» — это один клик и он закрывает пункт 1.5 целиком.
2. Письмо/форма в Mapi Research Trust по HADS с описанием нашего кейса (коммерческий продукт, РФ, электронная форма) — получить Special Terms в цифрах, а не пересказ.
3. Запрос в Columbia Lighthouse Project / RFMH про электронную реализацию в коммерческом продукте вне США — до того, как C-SSRS попадёт в правила.
4. Ручной проход по eLibrary и журналам («Российский психиатрический журнал», «Неврологический вестник», «Обозрение психиатрии») на валидации HADS/BDI/C-SSRS — поиск в этой сессии для таких запросов непригоден.
