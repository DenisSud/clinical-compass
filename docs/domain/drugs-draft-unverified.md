# Черновик данных: СИОЗС и серотониновая нагрузка

> **СТАТУС: НЕ ПРОВЕРЕНО. НЕ ЯВЛЯЕТСЯ ИСТОЧНИКОМ ДЛЯ ПРАВИЛ.**
> Это черновик, собранный агентом-исследователем по открытым публикациям
> инструкций. Одиннадцать полей не подтверждены первоисточником, часть — прямо
> противоречивы (период отмывки перед МАО: 7 дней в листке-вкладыше против 14 в
> инструкции 2014 г.). Ни одно значение отсюда не попадает в каталог препаратов
> и в правила алертинга, пока Антон или Коля не сверит его с действующей
> инструкцией в ГРЛС. Раздел (c) — список того, что обязан проверить человек.


**Статус документа:** черновик данных для клинической СППР. Не является инструкцией по применению.
**Ключевой принцип:** каждая фактическая ячейка имеет ключ `source`; всё, что не удалось подтвердить первичным источником, вынесено в раздел (c) и в поле `unsourced_fields` каждого объекта.
**Дата подготовки черновика:** собрано по состоянию публикаций, доступных на момент исследования (актуальные инструкции: Эсциталопрам — изм. 02.05.2023; Золофт листок-вкладыш — РУ ЛП-№(002851)-(РГ-RU); Авиандр — согласовано 01.09.2025). ГРЛС-записи проверялись через зеркала/агрегаторы, а не через интерактивный поиск grls.rosminzdrav.ru (см. «Ограничения проверки»).

**Оба препарата зарегистрированы в РФ под указанными МНН.** Замены не требуются.

---

## (a) JSON-массив объектов препаратов

```json
[
  {
    "id": "sertraline",
    "inn": "sertraline",
    "inn_ru": "сертралин",
    "atc": "N06AB06",
    "atc_source": "https://www.vidal.ru/drugs/sertraline",
    "registered_in_rf": true,
    "registered_in_rf_evidence": {
      "value": "МНН сертралин зарегистрирован в РФ; действующее РУ на препарат «Сертралин» — ЛП-№(010928)-(РГ-RU) от 15.07.2025 (держатель Фармпроект АО, Россия); РУ на «Золофт» — ЛП-№(002851)-(РГ-RU)",
      "source": "https://www.vidal.ru/drugs/sertraline",
      "secondary_source": "https://grls.pharm-portal.ru/grls/fcd23af9-50d9-42c0-af2e-ec78e704caf5",
      "secondary_source_2": "https://medi.ru/instrukciya/zoloft_8003/",
      "support": "direct evidence",
      "confidence": "high"
    },

    "trade_names": [
      {
        "name": "Сертралин",
        "holder": "Фармпроект АО (Россия)",
        "ru_number": "ЛП-№(010928)-(РГ-RU) от 15.07.2025",
        "source": "https://www.vidal.ru/drugs/sertraline",
        "support": "direct evidence",
        "confidence": "high",
        "comment": "РУ указано агрегатором Vidal в структурированном блоке «Лекарственные формы»; независимо подтверждено строкой «Регистрационное удостоверение ЛП- N (010928)- (РГ-RU)» в зеркале ГРЛС"
      },
      {
        "name": "Золофт® (Zoloft)",
        "holder": "Viatris / Pfizer (США); в РФ — представительство",
        "ru_number": "ЛП-№(002851)-(РГ-RU)",
        "source": "https://medi.ru/instrukciya/zoloft_8003/",
        "support": "direct evidence",
        "confidence": "high",
        "comment": "Номер РУ приведён в шапке официальной инструкции (листка-вкладыша), публикуемой medi.ru по ГРЛС"
      },
      {
        "name": "Стимулотон® (Stimuloton)",
        "holder": "ЗАО «Фармацевтический завод ЭГИС» (Венгрия)",
        "ru_number": null,
        "source": "https://www.rlsnet.ru/drugs/stimuloton-2568",
        "support": "direct evidence (trade name/holder); РУ не найдено в доступном фрагменте",
        "confidence": "medium"
      },
      {
        "name": "Асентра® (Asentra)",
        "holder": "KRKA d.d., Novo mesto (Словения)",
        "ru_number": null,
        "source": "https://www.vidal.ru/drugs/sertraline",
        "support": "direct evidence (trade name/holder)",
        "confidence": "medium"
      },
      {
        "name": "Серената (Serenata)",
        "holder": "Torrent Pharmaceuticals (Индия)",
        "ru_number": null,
        "source": "https://www.vidal.ru/drugs/sertraline",
        "support": "direct evidence",
        "confidence": "medium"
      },
      {
        "name": "Серлифт (Serlift)",
        "holder": "Sun Pharmaceutical Industries (Индия)",
        "ru_number": "№ П-012258/01 от 24.12.2007 (устаревший формат РУ)",
        "source": "https://medi.ru/instrukciya/serlift_7542/",
        "support": "direct evidence",
        "confidence": "low",
        "comment": "Старый формат номера и дата 2007 г. — вероятно, РУ переоформлено; текущий номер НЕ подтверждён"
      },
      {
        "name": "Алевал (Aleval)",
        "holder": "Sun Pharmaceutical Industries (Индия)",
        "ru_number": null,
        "source": "https://www.vidal.ru/drugs/sertraline",
        "support": "direct evidence",
        "confidence": "medium"
      },
      {
        "name": "Сертралин Канон",
        "holder": "Канонфарма Продакшн (Россия)",
        "ru_number": null,
        "source": "https://www.vidal.ru/drugs/sertraline",
        "support": "direct evidence",
        "confidence": "medium"
      },
      {
        "name": "Золтралин солофарм",
        "holder": "Гротекс (Россия)",
        "ru_number": null,
        "source": "https://www.vidal.ru/drugs/sertraline",
        "support": "direct evidence",
        "confidence": "medium"
      }
    ],
    "trade_names_list_note": {
      "value": "Vidal перечисляет 9 синонимов/аналогов сертралина; полный перечень торговых наименований в ГРЛС может быть шире",
      "source": "https://www.vidal.ru/drugs/sertraline",
      "support": "interpretation",
      "confidence": "medium"
    },

    "forms_strengths": [
      {
        "form": "таблетки, покрытые плёночной оболочкой",
        "strengths": ["50 мг", "100 мг"],
        "source": "https://www.vidal.ru/drugs/sertraline",
        "support": "direct evidence",
        "confidence": "high"
      },
      {
        "form": "таблетки, покрытые оболочкой (Золофт)",
        "strengths": ["50 мг", "100 мг"],
        "source": "https://www.rlsnet.ru/drugs/zoloft-1348",
        "support": "direct evidence",
        "confidence": "high"
      },
      {
        "form_packaging_note": "50 мг — блистеры 7/10/14 шт., банки/флаконы 10/14/20/28/30 шт., пачки до 140 табл.; 100 мг — аналогично (по данным зеркала ГРЛС)",
        "source": "https://grls.pharm-portal.ru/grls/fcd23af9-50d9-42c0-af2e-ec78e704caf5",
        "support": "direct evidence",
        "confidence": "medium"
      },
      {
        "form_gap": "Таблетки 25 мг для сертралина в РФ по найденным источникам НЕ зарегистрированы; доза 25 мг достигается делением таблетки 50 мг (официально указано в листке-вкладыше Золофт)",
        "source": "https://medi.ru/instrukciya/zoloft_8003/",
        "support": "direct evidence (способ получения дозы 25 мг)",
        "confidence": "high"
      }
    ],

    "dosing": {
      "route": {
        "value": "Внутрь, 1 раз в сутки, утром или вечером, независимо от приёма пищи",
        "source": "https://medi.ru/instrukciya/zoloft_8003/",
        "support": "direct evidence",
        "confidence": "high"
      },
      "depression": {
        "start": "50 мг/сут",
        "titration": "повышение по 50 мг с интервалом не менее 1 недели",
        "max": "200 мг/сут",
        "source": "https://medi.ru/instrukciya/zoloft_8003/",
        "support": "direct evidence",
        "confidence": "high"
      },
      "ocd": {
        "start": "50 мг/сут (взрослые)",
        "titration": "по 50 мг с интервалом не менее 1 недели",
        "max": "200 мг/сут",
        "source": "https://medi.ru/instrukciya/zoloft_8003/",
        "support": "direct evidence",
        "confidence": "high"
      },
      "anxiety_indications_panic_social_ptsd": {
        "start": "25 мг/сут в течение 1-й недели (таблетку 50 мг разделить)",
        "step1": "через 1 неделю — 50 мг/сут",
        "titration": "далее повышение по 50 мг в течение нескольких недель",
        "max": "200 мг/сут",
        "source": "https://medi.ru/instrukciya/zoloft_8003/",
        "support": "direct evidence",
        "confidence": "high"
      },
      "gad": {
        "status": "ГТР НЕ входит в перечень показаний листка-вкладыша Золофт (РУ ЛП-№(002851)-(РГ-RU)); в инструкции Серлифт (старое РУ) ГТР указано с начальной дозой 50 мг и эффективной 50–200 мг",
        "source": "https://medi.ru/instrukciya/zoloft_8003/",
        "secondary_source": "https://medi.ru/instrukciya/serlift_7542/",
        "support": "direct evidence + interpretation",
        "confidence": "medium",
        "flag": "Расхождение между инструкциями разных ТН: назначать сертралин при ГТР в РФ можно только если ГТР есть в инструкции конкретного препарата"
      },
      "children": {
        "ocd_6_12_years": "начальная 25 мг/сут, через 1 неделю 50 мг/сут, далее ступенчато по 50 мг; max 200 мг/сут",
        "ocd_13_17_years": "начальная 50 мг/сут; max 200 мг/сут",
        "indication_limit": "только ОКР у детей 6 лет и старше",
        "source": "https://medi.ru/instrukciya/zoloft_8003/",
        "support": "direct evidence",
        "confidence": "high"
      },
      "elderly": {
        "value": "Коррекции дозы не требуется; тот же диапазон доз, что у молодых",
        "source": "https://www.rlsnet.ru/drugs/zoloft-1348",
        "support": "direct evidence",
        "confidence": "high"
      },
      "duration": {
        "value": "Начальный эффект — около 7 дней, полный — 2–4 недели (при ОКР медленнее); при депрессии лечение продолжают не менее 6 месяцев после улучшения; поддерживающая доза — минимальная эффективная",
        "source": "https://medi.ru/instrukciya/zoloft_8003/",
        "support": "direct evidence",
        "confidence": "high"
      }
    },

    "indications_registered": [
      {
        "text": "депрессия и профилактика рецидива депрессии (у взрослых)",
        "source": "https://medi.ru/instrukciya/zoloft_8003/",
        "support": "direct evidence",
        "confidence": "high"
      },
      {
        "text": "паническое расстройство (у взрослых)",
        "source": "https://medi.ru/instrukciya/zoloft_8003/",
        "support": "direct evidence",
        "confidence": "high"
      },
      {
        "text": "обсессивно-компульсивное расстройство (ОКР) (у взрослых, детей и подростков в возрасте 6 лет и старше)",
        "source": "https://medi.ru/instrukciya/zoloft_8003/",
        "support": "direct evidence",
        "confidence": "high"
      },
      {
        "text": "социальное тревожное расстройство (у взрослых)",
        "source": "https://medi.ru/instrukciya/zoloft_8003/",
        "support": "direct evidence",
        "confidence": "high"
      },
      {
        "text": "посттравматическое стрессовое расстройство (ПТСР) (у взрослых)",
        "source": "https://medi.ru/instrukciya/zoloft_8003/",
        "support": "direct evidence",
        "confidence": "high"
      },
      {
        "text": "Альтернативная (более широкая) формулировка из инструкции 2014 г.: «депрессии различной этиологии (лечение и профилактика); обсессивно-компульсивные расстройства; панические расстройства; посттравматические стрессовые расстройства (ПТСР); социальная фобия»",
        "source": "https://www.rlsnet.ru/drugs/zoloft-1348",
        "support": "direct evidence",
        "confidence": "medium",
        "flag": "Формулировки показаний различаются между версиями/ТН — для СППР использовать текст инструкции конкретного ТН"
      }
    ],

    "contraindications": [
      {
        "text": "гиперчувствительность к сертралину или любому компоненту препарата",
        "source": "https://medi.ru/instrukciya/zoloft_8003/",
        "support": "direct evidence",
        "confidence": "high"
      },
      {
        "text": "приём ингибиторов МАО (в т.ч. селегилин, моклобемид, линезолид, метиленовый синий) — «Не применяйте Золофт® вместе с данными лекарственными препаратами»",
        "source": "https://medi.ru/instrukciya/zoloft_8003/",
        "support": "direct evidence",
        "confidence": "high"
      },
      {
        "text": "приём пимозида",
        "source": "https://medi.ru/instrukciya/zoloft_8003/",
        "support": "direct evidence",
        "confidence": "high"
      },
      {
        "text": "беременность (формулировка инструкции 2014 г.) / «только если ожидаемая польза превышает риск» (формулировка листка-вкладыша) — СМ. раздел pregnancy",
        "source": "https://www.rlsnet.ru/drugs/zoloft-1348",
        "secondary_source": "https://medi.ru/instrukciya/zoloft_8003/",
        "support": "direct evidence",
        "confidence": "medium",
        "flag": "Прямое противоречие между версиями инструкции: «беременность» как противопоказание vs «только по жизненным показаниям». Не разрешать автоматически."
      },
      {
        "text": "период грудного вскармливания (инструкция 2014 г.); листок-вкладыш: «только если польза превосходит риск»",
        "source": "https://www.rlsnet.ru/drugs/zoloft-1348",
        "secondary_source": "https://medi.ru/instrukciya/zoloft_8003/",
        "support": "direct evidence",
        "confidence": "medium",
        "flag": "Расхождение формулировок между версиями"
      },
      {
        "text": "детский возраст до 6 лет",
        "source": "https://www.rlsnet.ru/drugs/zoloft-1348",
        "support": "direct evidence",
        "confidence": "high"
      }
    ],
    "cautions_registered": [
      {
        "text": "органические заболевания головного мозга (в т.ч. задержка умственного развития); эпилепсия; печёночная и/или почечная недостаточность; выраженное снижение массы тела; склонность к кровотечениям; гипонатриемия; закрытоугольная глаукома; удлинение интервала QT/заболевания сердца/низкий K или Mg; СД; ЭСТ; пожилой возраст",
        "source": "https://www.rlsnet.ru/drugs/zoloft-1348",
        "secondary_source": "https://medi.ru/instrukciya/zoloft_8003/",
        "support": "direct evidence",
        "confidence": "high"
      }
    ],

    "interactions": {
      "maoi": {
        "rule": "Противопоказано совместное применение. Сертралин нельзя начинать ранее чем через 14 дней после отмены ингибитора МАО (включая моклобемид, селегилин, линезолид, метиленовый синий).",
        "washout_after_serraline": "листок-вкладыш (РУ ЛП-№(002851)-(РГ-RU)): «После прекращения лечения сертралином Вы должны подождать как минимум одну неделю перед тем, как начинать прием ИМАО»",
        "source": "https://medi.ru/instrukciya/zoloft_8003/",
        "support": "direct evidence",
        "confidence": "high"
      },
      "maoi_conflict": {
        "rule": "Инструкция 2014 г. (профессиональная): «после отмены сертралина в течение 14 дней не назначают ингибиторы МАО» — то есть 14 дней, а не 7",
        "source": "https://www.rlsnet.ru/drugs/zoloft-1348",
        "support": "direct evidence",
        "confidence": "high",
        "flag": "КОНФЛИКТ ИСТОЧНИКОВ: 7 дней (листок-вкладыш, актуальное РУ) vs 14 дней (инструкция 2014 г.). Для СППР — использовать 14 дней как более консервативный интервал, но пометить как спорное."
      },
      "serotonergic": {
        "rule": "Осторожность/избегать: триптофан, фенфлурамин, 5-HT-агонисты, триптаны (суматриптан), трамадол, фентанил и другие опиоиды, литий, зверобой (Hypericum perforatum), амфетамины, метамизол, метиленовый синий, линезолид; риск серотонинового синдрома и ЗНС",
        "source": "https://www.rlsnet.ru/drugs/zoloft-1348",
        "secondary_source": "https://medi.ru/instrukciya/zoloft_8003/",
        "support": "direct evidence",
        "confidence": "high"
      },
      "qt": {
        "rule": "QT-удлинение не является противопоказанием. Требуется осторожность у пациентов с удлинением QT в анамнезе/в семейном анамнезе, заболеваниями сердца, низким K/Mg, брадикардией, а также при сочетании с препаратами, удлиняющими QT",
        "source": "https://medi.ru/instrukciya/zoloft_8003/",
        "support": "direct evidence",
        "confidence": "high"
      },
      "cyp2d6": {
        "rule": "Сертралин (50 мг/сут длительно) повышает концентрацию препаратов, метаболизируемых CYP2D6: ТЦА, антиаритмики IC класса (пропафенон, флекаинид); в листке-вкладыше также метопролол; при узком терапевтическом индексе — коррекция дозы/контроль",
        "source": "https://www.rlsnet.ru/drugs/zoloft-1348",
        "secondary_source": "https://medi.ru/instrukciya/zoloft_8003/",
        "support": "direct evidence",
        "confidence": "high"
      },
      "cyp2c19_cyp2c9_cyp1a2": {
        "rule": "Сертралин не угнетает CYP2C9 (концентрации толбутамида, фенитоина, варфарина не меняются) и, по данным in vitro, практически не влияет на CYP1A2; не влияет на концентрацию диазепама (отсутствие ингибирования CYP2C19)",
        "source": "https://www.rlsnet.ru/drugs/zoloft-1348",
        "support": "direct evidence",
        "confidence": "high"
      },
      "bleeding_nsaid_anticoag": {
        "rule": "СИОЗС повышают риск кровотечений при сочетании с НПВП, ацетилсалициловой кислотой, антикоагулянтами (варфарин — незначимое, но статистически достоверное увеличение ПВ; контроль ПВ в начале лечения и после отмены), антиагрегантами; осторожность при геморрагических заболеваниях в анамнезе",
        "source": "https://www.rlsnet.ru/drugs/zoloft-1348",
        "secondary_source": "https://medi.ru/instrukciya/zoloft_8003/",
        "support": "direct evidence",
        "confidence": "high"
      },
      "other": {
        "rule": "Циметидин значительно снижает клиренс сертралина; связывание с белками (диазепам, толбутамид) — возможен эффект вытеснения; контроль глюкозы при толбутамиде; контроль уровня фенитоина; грейпфрутовый сок повышает концентрацию сертралина (листок-вкладыш); алкоголь не рекомендуется",
        "source": "https://www.rlsnet.ru/drugs/zoloft-1348",
        "secondary_source": "https://medi.ru/instrukciya/zoloft_8003/",
        "support": "direct evidence",
        "confidence": "high"
      }
    },

    "pregnancy": {
      "value": "Безопасность полностью не установлена; применять только если польза для матери превышает риск для плода. При приёме в конце беременности — повышенный риск послеродового кровотечения; в III триместре — риск персистирующей лёгочной гипертензии новорождённого (ПЛГН); у новорождённого возможны симптомы отмены/серотонинергические эффекты в первые 24 ч",
      "source": "https://medi.ru/instrukciya/zoloft_8003/",
      "support": "direct evidence",
      "confidence": "high"
    },
    "lactation": {
      "value": "Сертралин проникает в грудное молоко; применять только если польза превосходит риск (листок-вкладыш); инструкция 2014 г. — «лечение не рекомендуется, при необходимости кормление прекратить»",
      "source": "https://www.rlsnet.ru/drugs/zoloft-1348",
      "secondary_source": "https://medi.ru/instrukciya/zoloft_8003/",
      "support": "direct evidence",
      "confidence": "medium",
      "flag": "Формулировки расходятся между версиями инструкции"
    },
    "fertility": {
      "value": "На животных некоторые СИОЗС снижают качество спермы; у человека не доказано",
      "source": "https://medi.ru/instrukciya/zoloft_8003/",
      "support": "direct evidence",
      "confidence": "high"
    },

    "renal_adjustment": {
      "value": "Коррекция дозы не требуется. У больных с Cl креатинина 30–60 мл/мин и 10–29 мл/мин AUC0–24 и Cmax существенно не отличались от контроля; T1/2 одинаков",
      "source": "https://www.rlsnet.ru/drugs/zoloft-1348",
      "secondary_source": "https://www.rlsnet.ru/drugs/stimuloton-2568",
      "support": "direct evidence",
      "confidence": "high"
    },
    "hepatic_adjustment": {
      "value": "Применять с осторожностью; при печёночной недостаточности — снижение дозы или увеличение интервалов между приёмами. Обоснование: у больных стабильным циррозом лёгкого течения T1/2 увеличено, AUC и Cmax почти в 3 раза выше",
      "source": "https://www.rlsnet.ru/drugs/zoloft-1348",
      "secondary_source": "https://www.rlsnet.ru/drugs/stimuloton-2568",
      "support": "direct evidence",
      "confidence": "high"
    },

    "discontinuation": {
      "rule": "Не прекращать резко. Дозу снижать постепенно в течение нескольких недель (при необходимости — месяцев). Реакции отмены часты, обычно лёгкие/умеренные, появляются в первые дни, проходят в течение 2 недель, у части пациентов — 2–3 месяца и дольше. Симптомы: головокружение, парестезии/ощущение «удара током», нарушения сна, ажитация/тревога, тошнота/рвота, тремор, спутанность, потливость, головная боль, диарея, сердцебиение, эмоциональная лабильность, раздражительность, нарушения зрения",
      "source": "https://medi.ru/instrukciya/zoloft_8003/",
      "support": "direct evidence",
      "confidence": "high"
    },

    "monitoring": [
      {
        "item": "Суицидальные мысли/поведение: особенно в начале терапии и при изменении дозы; повышенный риск суицидального поведения у взрослых <25 лет",
        "source": "https://medi.ru/instrukciya/zoloft_8003/",
        "support": "direct evidence",
        "confidence": "high"
      },
      {
        "item": "Серотониновый синдром и ЗНС — клинический мониторинг (ажитация, тремор, миоклонус, гипертермия, ригидность, вегетативная лабильность)",
        "source": "https://www.rlsnet.ru/drugs/zoloft-1348",
        "support": "direct evidence",
        "confidence": "high"
      },
      {
        "item": "Гипонатриемия (пожилые, диуретики, цирроз): головная боль, снижение концентрации, нарушение памяти, слабость, неустойчивость, падения",
        "source": "https://www.rlsnet.ru/drugs/zoloft-1348",
        "support": "direct evidence",
        "confidence": "high"
      },
      {
        "item": "Кровотечения: контроль ПВ при варфарине в начале лечения и после отмены; наблюдение при сочетании с НПВП/АСК/антиагрегантами; кожные кровоизлияния",
        "source": "https://www.rlsnet.ru/drugs/zoloft-1348",
        "support": "direct evidence",
        "confidence": "high"
      },
      {
        "item": "Гликемия при сахарном диабете (может потребоваться коррекция доз инсулина/пероральных препаратов)",
        "source": "https://medi.ru/instrukciya/zoloft_8003/",
        "support": "direct evidence",
        "confidence": "high"
      },
      {
        "item": "Акатизия/психомоторное беспокойство в первые недели (повышение дозы может ухудшить)",
        "source": "https://medi.ru/instrukciya/zoloft_8003/",
        "support": "direct evidence",
        "confidence": "high"
      },
      {
        "item": "Активация мании/гипомании; судороги; уровень фенитоина при совместном приёме; АД (возможно повышение)",
        "source": "https://www.rlsnet.ru/drugs/zoloft-1348",
        "secondary_source": "https://medi.ru/instrukciya/zoloft_8003/",
        "support": "direct evidence",
        "confidence": "high"
      },
      {
        "item": "Печёночные трансаминазы при длительном применении (асимптоматическое повышение, обратимое)",
        "source": "https://www.rlsnet.ru/drugs/zoloft-1348",
        "support": "direct evidence",
        "confidence": "medium"
      }
    ],

    "unsourced_fields": [
      "РУ для ТН Стимулотон, Асентра, Серената, Алевал, Сертралин Канон, Золтралин солофарм — не подтверждены",
      "Текущий (действующий) номер РУ для Серлифт — не подтверждён (найден только № П-012258/01 от 24.12.2007)",
      "Наличие/отсутствие дозировки 25 мг в зарегистрированных в РФ формах — не подтверждено прямым перечнем ГРЛС",
      "Показание «генерализованное тревожное расстройство» для сертралина: есть в инструкции Серлифт (старое РУ) и в клинических рекомендациях, но НЕ в актуальном листке-вкладыше Золофт — требует проверки по инструкции конкретного ТН",
      "Явные требования к ЭКГ/контролю QT для сертралина в РФ-инструкциях не найдены (в тексте есть только «осторожность»)"
    ]
  },

  {
    "id": "escitalopram",
    "inn": "escitalopram",
    "inn_ru": "эсциталопрам",
    "atc": "N06AB10",
    "atc_source": "https://www.vidal.ru/drugs/escitalopram__44993",
    "registered_in_rf": true,
    "registered_in_rf_evidence": {
      "value": "МНН эсциталопрам зарегистрирован в РФ. Примеры действующих РУ: «Эсциталопрам» (Пранафарм) — ЛП-№(010581)-(РГ-RU) (инструкция изм. 02.05.2023); «Эсциталопрам» (Березовский фармзавод) — ЛП-№(008467)-(РГ-RU) от 16.01.2025 (ранее ЛП-003256); «Ципралекс» — ЛП-№(011897)-(РГ-RU)",
      "source": "https://www.rlsnet.ru/drugs/escitalopram-66941",
      "secondary_source": "https://www.vidal.ru/drugs/escitalopram__44993",
      "secondary_source_2": "https://zdravmedinform.ru/grls/reg-lp-011897-rg-ru.html",
      "support": "direct evidence (Пранафарм, Березовский); Ципралекс — только из поисковой выдачи зеркала ГРЛС",
      "confidence": "high"
    },

    "trade_names": [
      {
        "name": "Эсциталопрам",
        "holder": "ООО «ПРАНАФАРМ» (Россия)",
        "ru_number": "ЛП-№(010581)-(РГ-RU)",
        "source": "https://www.rlsnet.ru/drugs/escitalopram-66941",
        "support": "direct evidence",
        "confidence": "high",
        "comment": "Наиболее свежая из найденных инструкций (дата изменения 02.05.2023) — использована как основной источник по dosing/interactions"
      },
      {
        "name": "Эсциталопрам",
        "holder": "ЗАО «Березовский фармацевтический завод» (Россия)",
        "ru_number": "ЛП-№(008467)-(РГ-RU) от 16.01.2025 (бессрочно; предыдущий ЛП-003256)",
        "source": "https://www.vidal.ru/drugs/escitalopram__44993",
        "support": "direct evidence",
        "confidence": "high"
      },
      {
        "name": "Ципралекс® (Cipralex)",
        "holder": "H. Lundbeck A/S (Дания)",
        "ru_number": "ЛП-№(011897)-(РГ-RU) (в старых публикациях инструкции — П №015653/01)",
        "source": "https://zdravmedinform.ru/grls/reg-lp-011897-rg-ru.html",
        "secondary_source": "https://medi.ru/instrukciya/tsipraleks_1879/",
        "support": "direct evidence (номер РУ — из поисковой выдачи зеркала ГРЛС и шапки старой инструкции)",
        "confidence": "medium",
        "flag": "Текст инструкции на medi.ru соответствует СТАРОМУ РУ (П №015653/01); актуальность текста под текущим РУ не подтверждена"
      },
      {
        "name": "Элицея® / Элицея® КУ-Таб®",
        "holder": "KRKA d.d., Novo mesto (Словения)",
        "ru_number": null,
        "source": "https://www.vidal.ru/drugs/escitalopram__44993",
        "support": "direct evidence",
        "confidence": "medium"
      },
      {
        "name": "Селектра (Selectra)",
        "holder": "Abbott Products Operations (Швейцария)",
        "ru_number": null,
        "source": "https://www.vidal.ru/drugs/escitalopram__44993",
        "support": "direct evidence",
        "confidence": "medium"
      },
      {
        "name": "Ленуксин® (Lenuxin)",
        "holder": "Gedeon Richter (Венгрия)",
        "ru_number": null,
        "source": "https://www.vidal.ru/drugs/escitalopram__44993",
        "support": "direct evidence",
        "confidence": "medium"
      },
      {
        "name": "Цивельт",
        "holder": "Гротекс (Россия)",
        "ru_number": null,
        "source": "https://www.vidal.ru/drugs/escitalopram__44993",
        "support": "direct evidence",
        "confidence": "medium"
      },
      {
        "name": "Эсциталопрам Канон / Эсциталопрам Реневал / Эсциталопрам (Фармасинтез-Тюмень)",
        "holder": "Канонфарма Продакшн; ПФК Обновление; Фармасинтез-Тюмень",
        "ru_number": null,
        "source": "https://www.vidal.ru/drugs/escitalopram__44993",
        "support": "direct evidence",
        "confidence": "medium"
      }
    ],
    "trade_names_list_note": {
      "value": "Vidal перечисляет 17 синонимов/аналогов эсциталопрама, включая перечисленные выше",
      "source": "https://www.vidal.ru/drugs/escitalopram__44993",
      "support": "direct evidence",
      "confidence": "medium"
    },

    "forms_strengths": [
      {
        "form": "таблетки, покрытые плёночной оболочкой",
        "strengths": ["5 мг", "10 мг", "20 мг"],
        "source": "https://www.rlsnet.ru/drugs/escitalopram-66941",
        "support": "direct evidence",
        "confidence": "high",
        "comment": "Таблетка 20 мг — с риской; 5 и 10 мг — без риски (Пранафарм)"
      },
      {
        "form": "таблетки, покрытые оболочкой (Ципралекс)",
        "strengths": ["5 мг", "10 мг", "20 мг"],
        "source": "https://medi.ru/instrukciya/tsipraleks_1879/",
        "support": "direct evidence",
        "confidence": "medium"
      },
      {
        "form": "таблетки, покрытые плёночной оболочкой (Березовский фармзавод)",
        "strengths": ["10 мг"],
        "source": "https://www.vidal.ru/drugs/escitalopram__44993",
        "support": "direct evidence",
        "confidence": "medium"
      }
    ],

    "dosing": {
      "route": {
        "value": "Внутрь, 1 раз в сутки, независимо от приёма пищи",
        "source": "https://www.rlsnet.ru/drugs/escitalopram-66941",
        "support": "direct evidence",
        "confidence": "high"
      },
      "depression": {
        "start": "10 мг/сут",
        "max": "20 мг/сут",
        "titration": "при недостаточном эффекте — увеличение до 20 мг/сут по индивидуальной реакции",
        "onset": "антидепрессивный эффект через 2–4 недели; продолжать не менее 6 месяцев после исчезновения симптомов",
        "source": "https://www.rlsnet.ru/drugs/escitalopram-66941",
        "support": "direct evidence",
        "confidence": "high"
      },
      "panic_disorder": {
        "start": "5 мг/сут в течение первой недели",
        "step1": "затем 10 мг/сут",
        "max": "20 мг/сут",
        "note": "максимальный эффект примерно через 3 месяца; терапия несколько месяцев",
        "source": "https://www.rlsnet.ru/drugs/escitalopram-66941",
        "support": "direct evidence",
        "confidence": "high"
      },
      "social_anxiety_disorder": {
        "start": "10 мг/сут",
        "max": "20 мг/сут",
        "duration": "минимум 3 месяца; для профилактики рецидива 6 месяцев и дольше (в старой инструкции Ципралекса — минимум 12 недель)",
        "source": "https://www.rlsnet.ru/drugs/escitalopram-66941",
        "support": "direct evidence",
        "confidence": "high"
      },
      "gad": {
        "start": "10 мг/сут",
        "max": "20 мг/сут",
        "duration": "минимум 3 месяца; допускается 6 месяцев и дольше",
        "source": "https://www.rlsnet.ru/drugs/escitalopram-66941",
        "support": "direct evidence",
        "confidence": "high"
      },
      "ocd": {
        "start": "10 мг/сут",
        "max": "20 мг/сут",
        "duration": "не менее 6 месяцев; для профилактики рецидива — не менее 1 года",
        "source": "https://www.rlsnet.ru/drugs/escitalopram-66941",
        "support": "direct evidence",
        "confidence": "high"
      },
      "elderly": {
        "value": "Половина обычной дозы: 5 мг/сут; максимальная — 10 мг/сут (старше 65 лет)",
        "source": "https://www.rlsnet.ru/drugs/escitalopram-66941",
        "support": "direct evidence",
        "confidence": "high"
      },
      "children": {
        "value": "Не применять до 18 лет (эффективность и безопасность не подтверждены)",
        "source": "https://www.rlsnet.ru/drugs/escitalopram-66941",
        "support": "direct evidence",
        "confidence": "high"
      },
      "max_dose_overall": {
        "value": "20 мг/сут (у пожилых — 10 мг/сут; при печёночной недостаточности и у медленных метаболизаторов CYP2C19 — 10 мг/сут)",
        "source": "https://www.rlsnet.ru/drugs/escitalopram-66941",
        "support": "direct evidence",
        "confidence": "high"
      }
    },

    "indications_registered": [
      {
        "text": "Депрессивные эпизоды любой степени тяжести",
        "source": "https://www.rlsnet.ru/drugs/escitalopram-66941",
        "support": "direct evidence",
        "confidence": "high"
      },
      {
        "text": "Панические расстройства с/без агорафобии",
        "source": "https://www.rlsnet.ru/drugs/escitalopram-66941",
        "support": "direct evidence",
        "confidence": "high"
      },
      {
        "text": "Социальное тревожное расстройство (социальная фобия)",
        "source": "https://www.rlsnet.ru/drugs/escitalopram-66941",
        "support": "direct evidence",
        "confidence": "high"
      },
      {
        "text": "Генерализованное тревожное расстройство",
        "source": "https://www.rlsnet.ru/drugs/escitalopram-66941",
        "support": "direct evidence",
        "confidence": "high"
      },
      {
        "text": "Обсессивно-компульсивное расстройство",
        "source": "https://www.rlsnet.ru/drugs/escitalopram-66941",
        "support": "direct evidence",
        "confidence": "high"
      },
      {
        "text": "Более узкая формулировка из сводки Vidal (не инструкция): «Депрессия, панические расстройства (в т.ч. с агорафобией)»",
        "source": "https://www.vidal.ru/drugs/escitalopram__44993",
        "support": "direct evidence",
        "confidence": "low",
        "flag": "Сводка Vidal — обобщающий текст, официально предупреждает, что «не может быть использована для принятия решения о возможности применения конкретного препарата». НЕ использовать как источник показаний."
      }
    ],

    "contraindications": [
      {
        "text": "Повышенная чувствительность к эсциталопраму и другим компонентам препарата",
        "source": "https://www.rlsnet.ru/drugs/escitalopram-66941",
        "support": "direct evidence",
        "confidence": "high"
      },
      {
        "text": "Одновременный приём неселективных необратимых ингибиторов МАО",
        "source": "https://www.rlsnet.ru/drugs/escitalopram-66941",
        "support": "direct evidence",
        "confidence": "high"
      },
      {
        "text": "Одновременный приём пимозида",
        "source": "https://www.rlsnet.ru/drugs/escitalopram-66941",
        "support": "direct evidence",
        "confidence": "high"
      },
      {
        "text": "Детский и подростковый возраст (до 18 лет) — эффективность и безопасность не подтверждены",
        "source": "https://www.rlsnet.ru/drugs/escitalopram-66941",
        "support": "direct evidence",
        "confidence": "high"
      },
      {
        "text": "ДОПОЛНИТЕЛЬНО в старой инструкции Ципралекса: беременность и период грудного вскармливания указаны как противопоказания",
        "source": "https://medi.ru/instrukciya/tsipraleks_1879/",
        "support": "direct evidence",
        "confidence": "medium",
        "flag": "КОНФЛИКТ: инструкция Пранафарм (2023) НЕ считает беременность противопоказанием («только в случаях крайней необходимости»); старая инструкция Ципралекса — считает. Разрешать по инструкции конкретного ТН."
      },
      {
        "text": "ДОПОЛНИТЕЛЬНО (не в РФ-инструкции, а в SmPC Cipralex, UK): «Escitalopram is contraindicated in patients with known QT interval prolongation or congenital long QT syndrome. Escitalopram is contraindicated together with medicinal products that are known to prolong the QT interval»",
        "source": "https://www.medicines.org.uk/emc/product/7718/smpc",
        "support": "direct evidence (для UK SmPC); НЕ найдено в РФ-инструкциях",
        "confidence": "high",
        "flag": "КРИТИЧНО ДЛЯ СППР: противопоказание по QT и комбинациям QT-удлиняющих препаратов есть в EU/UK SmPC, но в проверенных РФ-инструкциях (Пранафарм 2023, Ципралекс старая) в разделе «Противопоказания» отсутствует. Нужна проверка клиницистом по актуальной РФ-инструкции."
      },
      {
        "text": "ДОПОЛНИТЕЛЬНО в SmPC: комбинация с обратимыми ингибиторами МАО (моклобемид) и линезолидом противопоказана из-за риска серотонинового синдрома",
        "source": "https://www.medicines.org.uk/emc/product/7069/smpc",
        "support": "direct evidence (UK SmPC)",
        "confidence": "high",
        "flag": "В РФ-инструкции моклобемид — «не рекомендуется», линезолид не упомянут. Расхождение по строгости."
      }
    ],
    "cautions_registered": [
      {
        "text": "Выраженная почечная недостаточность (КК <30 мл/мин), мания и гипомания, фармакологически неконтролируемая эпилепсия, выраженное суицидальное поведение, сахарный диабет, цирроз печени, склонность к кровотечениям, закрытоугольная глаукома/глаукома в анамнезе, моклобемид и селегилин, серотонинергические препараты, средства, снижающие порог судорожной готовности, литий, триптофан, зверобой, пероральные антикоагулянты и средства, влияющие на свёртываемость, препараты, вызывающие гипонатриемию, субстраты/ингибиторы CYP2C19, этанол, ЭСТ, пожилой возраст, беременность, грудное вскармливание",
        "source": "https://www.rlsnet.ru/drugs/escitalopram-66941",
        "support": "direct evidence",
        "confidence": "high"
      }
    ],

    "interactions": {
      "maoi": {
        "rule": "Запрещено применять с неселективными необратимыми МАО. Эсциталопрам можно начать через 14 дней после отмены необратимых МАО. Перед началом приёма неселективных необратимых МАО должно пройти не менее 7 дней после окончания приёма эсциталопрама.",
        "source": "https://www.rlsnet.ru/drugs/escitalopram-66941",
        "support": "direct evidence",
        "confidence": "high"
      },
      "moclobemide_selegiline": {
        "rule": "Моклобемид (обратимый селективный МАО-A): не рекомендуется, риск серотонинового синдрома; при клинической необходимости — минимальные дозы и мониторинг; эсциталопрам можно начать минимум через 1 день после отмены моклобемида. Селегилин (необратимый МАО-B): осторожность, риск серотонинового синдрома.",
        "source": "https://www.rlsnet.ru/drugs/escitalopram-66941",
        "support": "direct evidence",
        "confidence": "high"
      },
      "serotonergic": {
        "rule": "Совместное применение с серотонинергическими препаратами (трамадол, суматриптан и другие триптаны) может привести к серотониновому синдрому; осторожность с литием и триптофаном; зверобой увеличивает число побочных эффектов; препараты, снижающие порог судорожной готовности (ТЦА, СИОЗС, нейролептики — фенотиазины, тиоксантены, бутирофеноны, мефлохин, бупропион, трамадол) — риск судорог",
        "source": "https://www.rlsnet.ru/drugs/escitalopram-66941",
        "support": "direct evidence",
        "confidence": "high"
      },
      "qt": {
        "rule": "В разделе «Взаимодействие» РФ-инструкции отдельного блока про QT-удлиняющие препараты НЕТ. QT-эффект отражён в разделах «Побочные действия» («частота неизвестна: удлинение интервала QT») и «Передозировка» (удлинение QT, аритмия); приведены данные ЭКГ: ΔQTc 4,3 мс при 10 мг/сут и 10,7 мс при 30 мг/сут",
        "source": "https://www.rlsnet.ru/drugs/escitalopram-66941",
        "support": "direct evidence",
        "confidence": "high",
        "flag": "См. также SmPC (https://www.medicines.org.uk/emc/product/7718/smpc) — там комбинация с QT-удлиняющими препаратами противопоказана. В РФ-тексте такой формулировки не найдено."
      },
      "cyp2c19": {
        "rule": "Основной путь метаболизма — CYP2C19. Омепразол (ингибитор CYP2C19) повышает концентрацию эсциталопрама примерно на 50%; циметидин (CYP2D6/3A4/1A2) — примерно на 70%. С осторожностью применять максимальные дозы с ингибиторами CYP2C19 (омепразол, флуоксетин, флувоксамин, лансопразол, тиклопидин) и циметидином; может потребоваться снижение дозы.",
        "source": "https://www.rlsnet.ru/drugs/escitalopram-66941",
        "support": "direct evidence",
        "confidence": "high"
      },
      "cyp2d6": {
        "rule": "Эсциталопрам является ингибитором CYP2D6. Осторожность с препаратами с узким терапевтическим индексом (флекаинид, пропафенон, метопролол при сердечной недостаточности) и с препаратами, метаболизируемыми CYP2D6 и действующими на ЦНС (дезипрамин, кломипрамин, нортриптилин, рисперидон, тиоридазин, галоперидол); может потребоваться коррекция дозы. Эсциталопрам + дезипрамин или метопролол → двукратное повышение концентрации последних.",
        "source": "https://www.rlsnet.ru/drugs/escitalopram-66941",
        "support": "direct evidence",
        "confidence": "high"
      },
      "bleeding_nsaid_anticoag": {
        "rule": "Возможны нарушения свёртываемости при сочетании с пероральными антикоагулянтами и средствами, влияющими на свёртываемость (атипичные нейролептики, фенотиазины, большинство ТЦА, ацетилсалициловая кислота, НПВП, тиклопидин, дипиридамол); при начале/окончании терапии — тщательный мониторинг свёртываемости. Одновременный приём с НПВП может увеличить число кровотечений.",
        "source": "https://www.rlsnet.ru/drugs/escitalopram-66941",
        "support": "direct evidence",
        "confidence": "high"
      },
      "alcohol": {
        "rule": "Фармакодинамического/фармакокинетического взаимодействия с алкоголем нет, но совместный приём не рекомендуется",
        "source": "https://www.rlsnet.ru/drugs/escitalopram-66941",
        "support": "direct evidence",
        "confidence": "high"
      }
    },

    "pregnancy": {
      "value": "Данные ограничены; исследования на животных показали репродуктивную токсичность. Применять только при крайней необходимости после оценки польза/риск. При приёме в поздние сроки — наблюдение за новорождённым (риск симптомов отмены/серотонинергических эффектов в первые 24 ч). Эпидемиологические данные: повышенный риск ПЛГН (~5 случаев на 1000 беременностей); повышенный (<2 раза) риск послеродового кровотечения при приёме СИОЗС/СИОЗСН в течение месяца до родов.",
      "source": "https://www.rlsnet.ru/drugs/escitalopram-66941",
      "support": "direct evidence",
      "confidence": "high",
      "flag": "Старая инструкция Ципралекса относит беременность к противопоказаниям — конфликт версий"
    },
    "lactation": {
      "value": "Ожидается выделение с грудным молоком; кормление грудью во время лечения не рекомендуется",
      "source": "https://www.rlsnet.ru/drugs/escitalopram-66941",
      "support": "direct evidence",
      "confidence": "high"
    },
    "fertility": {
      "value": "Данных по эсциталопраму на животных нет; по некоторым СИОЗС показано обратимое влияние на качество спермы; влияния на фертильность у человека до сих пор не наблюдалось",
      "source": "https://www.rlsnet.ru/drugs/escitalopram-66941",
      "support": "direct evidence",
      "confidence": "high"
    },

    "renal_adjustment": {
      "value": "При лёгкой и умеренной почечной недостаточности коррекции доз не требуется. При выраженной (КК <30 мл/мин) — с осторожностью (доза не специфицирована)",
      "source": "https://www.rlsnet.ru/drugs/escitalopram-66941",
      "support": "direct evidence",
      "confidence": "high"
    },
    "hepatic_adjustment": {
      "value": "Начальная доза 5 мг/сут в первые 2 недели, затем при хорошей переносимости и по индивидуальной реакции — до 10 мг/сут (по инструкции Пранафарм). В инструкции Ципралекса дополнительно: при выраженной печёночной недостаточности — осторожность при титровании дозы.",
      "source": "https://www.rlsnet.ru/drugs/escitalopram-66941",
      "secondary_source": "https://medi.ru/instrukciya/tsipraleks_1879/",
      "support": "direct evidence",
      "confidence": "high"
    },
    "cyp2c19_poor_metabolizer": {
      "value": "Начальная доза 5 мг/сут в первые 2 недели, затем до 10 мг/сут",
      "source": "https://www.rlsnet.ru/drugs/escitalopram-66941",
      "support": "direct evidence",
      "confidence": "high"
    },

    "discontinuation": {
      "rule": "Дозу снижать постепенно в течение 1–2 недель во избежание синдрома «отмены». Симптомы отмены (особенно при резкой отмене): головокружение, расстройства чувствительности (парестезии, ощущение прохождения тока), расстройства сна, ажитация/тревога, тошнота и/или рвота, тремор, спутанность сознания, повышенное потоотделение, головная боль, диарея, сердцебиение, эмоциональная нестабильность, раздражительность, расстройства зрения; обычно слабо/умеренно выражены и быстро проходят, но могут быть тяжёлыми и длительными",
      "source": "https://www.rlsnet.ru/drugs/escitalopram-66941",
      "support": "direct evidence",
      "confidence": "high"
    },

    "monitoring": [
      {
        "item": "Суицидальные мысли/поведение и клиническое ухудшение — особенно в начале терапии и при изменении дозы; повышенный риск суицидального поведения у пациентов <25 лет",
        "source": "https://www.rlsnet.ru/drugs/escitalopram-66941",
        "support": "direct evidence",
        "confidence": "high"
      },
      {
        "item": "Серотониновый синдром: ажитация, тремор, миоклонус, гипертермия — немедленная отмена СИОЗС и серотонинергических препаратов, симптоматическое лечение",
        "source": "https://www.rlsnet.ru/drugs/escitalopram-66941",
        "support": "direct evidence",
        "confidence": "high"
      },
      {
        "item": "Гипонатриемия (пожилые, цирроз печени, диуретики/препараты, вызывающие гипонатриемию)",
        "source": "https://www.rlsnet.ru/drugs/escitalopram-66941",
        "support": "direct evidence",
        "confidence": "high"
      },
      {
        "item": "Кровотечения/склонность к кровотечениям, мониторинг свёртываемости при антикоагулянтах и антиагрегантах",
        "source": "https://www.rlsnet.ru/drugs/escitalopram-66941",
        "support": "direct evidence",
        "confidence": "high"
      },
      {
        "item": "Акатизия/психомоторное возбуждение в первые недели (повышение дозы может ухудшить)",
        "source": "https://www.rlsnet.ru/drugs/escitalopram-66941",
        "support": "direct evidence",
        "confidence": "high"
      },
      {
        "item": "Гликемия при сахарном диабете (коррекция доз инсулина/пероральных гипогликемических)",
        "source": "https://www.rlsnet.ru/drugs/escitalopram-66941",
        "support": "direct evidence",
        "confidence": "high"
      },
      {
        "item": "Мания/гипомания, судороги, закрытоугольная глаукома (мидриаз)",
        "source": "https://www.rlsnet.ru/drugs/escitalopram-66941",
        "support": "direct evidence",
        "confidence": "high"
      },
      {
        "item": "ЭКГ/QTc: в РФ-инструкции как обязательное требование мониторинга НЕ прописано; есть данные о дозозависимом удлинении QTc (4,3 мс при 10 мг, 10,7 мс при 30 мг) и упоминание QT в побочных эффектах/передозировке. В SmPC — противопоказание при известном удлинении QT",
        "source": "https://www.rlsnet.ru/drugs/escitalopram-66941",
        "secondary_source": "https://www.medicines.org.uk/emc/product/7718/smpc",
        "support": "direct evidence + interpretation",
        "confidence": "medium",
        "flag": "НЕ утверждать в СППР, что ЭКГ-мониторинг «требуется по инструкции РФ» — такой формулировки не найдено"
      }
    ],

    "unsourced_fields": [
      "РУ для ТН Элицея, Элицея КУ-Таб, Селектра, Ленуксин, Цивельт, Эсциталопрам Канон, Эсциталопрам Реневал, Эсциталопрам (Фармасинтез-Тюмень) — не подтверждены",
      "Актуальность текста инструкции Ципралекс на medi.ru под текущим РУ ЛП-№(011897)-(РГ-RU) — не подтверждена (текст соответствует старому РУ П №015653/01)",
      "Наличие противопоказания по QT в АКТУАЛЬНОЙ РФ-инструкции эсциталопрама — не подтверждено (в проверенных текстах отсутствует, в UK SmPC есть)",
      "Требования к ЭКГ-мониторингу в РФ-инструкции — не найдены",
      "Дозировка/формы Ципралекса в текущей регистрации (набор 5/10/20 мг — по старой инструкции)"
    ]
  }
]
```

---

## (b) Русская справка: Авиандр (маритупирдин) + СИОЗС

**Короткий ответ.** Инструкция Авиандра **НЕ запрещает** одновременный приём с СИОЗС и **НЕ содержит СИОЗС в разделе «Противопоказания»**. Она требует **осторожности** и содержит **отдельный абзац с предупреждением о теоретическом риске серотонинового синдрома**. Формулировка «не рекомендуется сочетать с СИОЗС» — это НЕ текст инструкции (такая формулировка встречается на сайтах вопрос-ответ, например sprosivracha.com, и является чьей-то интерпретацией).

**Точные цитаты из инструкции (раздел «Взаимодействие»), источник: https://www.rlsnet.ru/drugs/aviandr-89501 (описание основано на официальной инструкции, утверждено производителем, дата согласования 01.09.2025; держатель РУ — ООО «Авинейро»):**

> «_Лекарственные препараты с серотонинергическим действием_
> В КИ межлекарственного взаимодействия было показано, что совместный прием препарата АВИАНДР® с препаратом из группы селективных ингибиторов серотонина и норадреналина (дулоксетин) не вызывал клинических проявлений, связанных с усилением серотонинергической передачи. Тем не менее, с учетом рецепторного профиля препарата АВИАНДР® и групповых фармакологических эффектов, предполагается, что применение препарата АВИАНДР® одновременно с серотонинергическими препаратами может вызывать эффекты, обусловленные усилением серотонинергической стимуляции (серотониновый синдром). Следует с осторожностью применять препарат АВИАНДР® с другими серотонинергическими препаратами (L-триптофан, препараты из группы триптанов, трамадол, препараты группы СИОЗС, трициклические антидепрессанты, литий, фентанил и зверобой продырявленный).»

> «_Ингибиторы изофермента CYP2D6_
> … Следует с осторожностью применять препарат АВИАНДР® с ингибиторами CYP2D6 (например, дифенгидрамин, тербинафин, хинидин, гидроксихлорохин, **препараты СИОЗС**).»

**Что при этом реально стоит в «Противопоказаниях» (там СИОЗС нет):** гиперчувствительность; эпилепсия и органические заболевания головного мозга; приём одновременно с ингибиторами МАО и в течение 2 нед после их отмены; почечная недостаточность средней и тяжёлой степени (СКФ <60 мл/мин); печёночная недостаточность класса А/В/С по Чайлд-Пью; беременность; период кормления грудью; детский возраст до 18 лет. — *источник тот же.*

**Что это значит практически (исследовательская интерпретация, НЕ текст инструкции):**
1. Комбинация «Авиандр + СИОЗС» — не противопоказание, а зона «с осторожностью» с явным предупреждением о серотониновом синдроме, особенно при добавлении к СИОЗС триптанов, трамадола, лития, фентанила, зверобоя, L-триптофана.
2. Обратите внимание на двойной механизм риска: серотонинергический (фармакодинамический) **плюс** фармакокинетический — СИОЗС указаны как ингибиторы CYP2D6, а маритупирдин метаболизируется с участием CYP2D6 (в КИ влияние полиморфизма CYP2D6 подтверждено; при этом отдельное КИ с дулоксетином значимых изменений ФК не показало — то есть это предостережение теоретическое, а не доказанное на людях).
3. В инструкции есть противоречие тональности: с дулоксетином (СИОЗСН) КИ не показало серотонинергических проявлений, но предупреждение всё равно сформулировано через «предполагается».

---

## (c) Поля, которые НЕ удалось подтвердить — клиницист обязан сверить с актуальной инструкцией/ГРЛС

**Блокирующие для автоматических подсказок (не использовать без проверки):**

| # | Поле | Препарат | Что известно | Почему не подтверждено |
|---|---|---|---|---|
| 1 | Период отмывки после отмены сертралина перед МАО | Сертралин | **7 дней** (листок-вкладыш, актуальное РУ ЛП-№(002851)-(РГ-RU), medi.ru) vs **14 дней** (инструкция 2014 г., rlsnet) — прямое противоречие | Два официальных текста расходятся; какой действует в текущей утверждённой инструкции — не установлено |
| 2 | Беременность как противопоказание | Сертралин | Инструкция 2014: «беременность» в противопоказаниях; листок-вкладыш: «только если польза > риск» | Разные версии одного ТН |
| 3 | Беременность как противопоказание | Эсциталопрам | Пранафарм (2023): НЕ противопоказание («крайняя необходимость»); Ципралекс (старое РУ): противопоказание | Разные ТН/версии; актуальность текста Ципралекса не подтверждена |
| 4 | Противопоказание при удлинении QT / комбинации с QT-удлиняющими препаратами | Эсциталопрам | В UK SmPC — есть; в проверенных РФ-инструкциях — НЕ найдено | Отрицательный результат поиска ≠ отсутствие в актуальной РФ-инструкции. Требует проверки по ГРЛС |
| 5 | Обязательность ЭКГ/QTc-мониторинга | Эсциталопрам, Сертралин | В РФ-текстах найдены только «осторожность» и описание QT-эффектов; явного требования мониторинга нет | Отсутствие формулировки не означает, что мониторинг не нужен клинически |
| 6 | РУ (номера) для большинства ТН | Оба | Подтверждены только: Сертралин ЛП-№(010928); Золофт ЛП-№(002851); Эсциталопрам (Пранафарм) ЛП-№(010581); Эсциталопрам (Березовский) ЛП-№(008467); Ципралекс ЛП-№(011897) (по выдаче зеркала) | Интерактивный поиск grls.rosminzdrav.ru недоступен для прямого запроса; остальные номера не найдены |
| 7 | Серлифт — действующее РУ | Сертралин | Найден только № П-012258/01 от 24.12.2007 | Старый формат номера, вероятно переоформлен |
| 8 | ГТР как показание для сертралина | Сертралин | Есть в инструкции Серлифт и в клинических рекомендациях; НЕТ в актуальном листке-вкладыше Золофт | Зависит от ТН; для СППР — проверять по инструкции конкретного препарата |
| 9 | Дозировка 25 мг сертралина | Сертралин | Таблеток 25 мг не найдено; 25 мг получают делением таблетки 50 мг | Прямого перечня зарегистрированных дозировок из ГРЛС нет |
| 10 | Актуальность текста инструкции Ципралекс | Эсциталопрам | Текст на medi.ru соответствует РУ П №015653/01 (старый формат) | Не подтверждено соответствие текущему ЛП-№(011897)-(РГ-RU) |
| 11 | Точный текст инструкции Авиандра в действующей редакции ГРЛС | Авиандр | Использована публикация rlsnet (согласование 01.09.2025, утверждено производителем) | PDF с ГРЛС не скачан; номер РУ Авиандра не установлен |

**Отдельно про метод проверки:** вызов `source_check` по утверждению об Авиандре вернул статус **unclear (confidence 0.30)** — автоматическая оценка семантической поддержки недоступна, вердикт не получен. Поэтому в разделе (b) использованы **дословные фрагменты** текста инструкции, снятые с rlsnet, а не выводы автоматической проверки. Это ограничение валидации, а не подтверждение.

---

## Serotonin syndrome — критерии (справочный блок, с источником)

**Hunter Serotonin Toxicity Criteria** (Dunkley EJ, Isbister GK, Sibbritt D, Dawson AH, Whyte IM. QJM. 2003;96(9):639 — цит. по AAFP). Требуется наличие серотонинергического агента **И** одно из пяти:
1. спонтанный клонус;
2. индуцируемый клонус + ажитация или потливость;
3. глазной (окулярный) клонус + ажитация или потливость;
4. тремор + гиперрефлексия;
5. гипертонус + температура >38 °C + глазной или индуцируемый клонус.

*Источник: https://www.aafp.org/pubs/afp/issues/2010/0501/p1139.html (Am Fam Physician. 2010;81(9):1139) — «Diagnosis with Hunter's criteria requires one of the following features or groups of features: spontaneous clonus; inducible clonus with agitation or diaphoresis; ocular clonus with agitation or diaphoresis; tremor and hyperreflexia; or hypertonia, temperature above 100.4°F (38°C), and ocular or inducible clonus».*

**Sternbach criteria** (1991): недавнее добавление/увеличение дозы известного серотонинергического препарата **И** ≥3 из 10 признаков: ажитация, потливость, диарея, лихорадка, гиперрефлексия, нарушение координации (атаксия), изменения психического статуса (спутанность, гипомания), миоклонус, озноб, тремор; **И** исключение других причин (в т.ч. отсутствие начала/изменения дозы нейролептиков, отсутствие злоупотребления психоактивными веществами/отмены).
*Источник: https://www.aafp.org/pubs/afp/issues/2010/0501/p1139.html (Table 3 + footnote «Sternbach's diagnostic criteria require three of 10 signs and symptoms»).*

**Сравнение (прямая цитата):** «Hunter's criteria are more sensitive (84 versus 75 percent) and more specific (97 versus 96 percent) than Sternbach's». *Источник: AAFP, там же.* → Рекомендуемый инструмент — Hunter.

**Клинически значимо для СППР:** триада — изменения психического статуса, вегетативная нестабильность, нейромышечная гипервозбудимость; клонус (особенно индуцируемый и глазной) — ключевой признак; дифференциальная диагностика с ЗНС, антихолинергическим синдромом, злокачественной гипертермией. *Источник: AAFP, там же (разделы Diagnosis, Table 4).*

---

## Contradictions (сводно)

1. **Сертралин → МАО: 7 дней vs 14 дней.** Листок-вкладыш (РУ ЛП-№(002851)-(РГ-RU)): «как минимум одну неделю». Инструкция 2014 г. (rlsnet Золофт): «в течение 14 дней не назначают ингибиторы МАО». Оба текста — официальные. Не разрешено; для СППР — консервативно 14 дней с пометкой «спорно».
2. **Беременность/лактация как противопоказание у сертралина:** противопоказание (2014) vs «только по показаниям» (актуальный листок-вкладыш).
3. **Эсциталопрам, беременность:** Пранафарм (2023) — не противопоказание; Ципралекс (старое РУ) — противопоказание.
4. **Эсциталопрам, QT:** UK SmPC — противопоказание при известном удлинении QT и при комбинации с QT-удлиняющими препаратами; РФ-инструкции (проверенные) — только «осторожность»/описание эффекта.
5. **Эсциталопрам, моклобемид/линезолид:** SmPC — противопоказано; РФ-инструкция — «не рекомендуется» (моклобемид), линезолид не упомянут.
6. **Авиандр:** инструкция — «с осторожностью» + теоретический риск серотонинового синдрома; вторичные сайты (sprosivracha.com) формулируют как «не рекомендуется» — это НЕ текст инструкции.

## Missing evidence
- Номера РУ для 13 из 18 торговых наименований.
- Прямой выгрузки из ГРЛС (интерактивный поиск) — не выполнялась из-за отсутствия прямого доступа к форме поиска.
- Точные перечни зарегистрированных дозировок (25 мг сертралина; набор дозировок Ципралекса в текущей редакции).
- Действующая редакция инструкции Авиандра в PDF с ГРЛС; номер его РУ.
- Русскоязычные официальные критерии серотонинового синдрома (в РФ-инструкциях есть только описание симптомов, без шкал) — не найдены.

## Sources
- **Kept:** Эсциталопрам, инструкция Пранафарм ЛП-№(010581)-(РГ-RU) (rlsnet.ru/drugs/escitalopram-66941) — самый свежий полный РФ-текст (02.05.2023): показания, противопоказания, дозы, ФК-взаимодействия, беременность.
- **Kept:** Золофт, листок-вкладыш РУ ЛП-№(002851)-(РГ-RU) (medi.ru/instrukciya/zoloft_8003/) — актуальные дозы, титрация, показания, отмена.
- **Kept:** Золофт, инструкция для специалистов 2014 (rlsnet.ru/drugs/zoloft-1348) — единственный найденный РФ-текст с ФК-обоснованием почечной/печёночной коррекции, ПВ/варфарин, CYP2D6, гипонатриемия.
- **Kept:** Стимулотон (rlsnet.ru/drugs/stimuloton-2568) — независимое подтверждение печёночной/почечной тактики для сертралина.
- **Kept:** Авиандр, официальная инструкция (rlsnet.ru/drugs/aviandr-89501) — дословный текст раздела «Взаимодействие».
- **Kept:** AAFP 2010 (aafp.org/pubs/afp/issues/2010/0501/p1139.html) — Hunter/Sternbach + чувствительность/специфичность + первоисточник Dunkley 2003.
- **Kept:** Cipralex SmPC (medicines.org.uk/emc/product/7718/smpc; 7069/smpc) — только для фиксации расхождения по QT и моклобемиду/линезолиду (не РФ-источник).
- **Kept:** Vidal (vidal.ru/drugs/sertraline; /escitalopram__44993) — номера РУ для двух позиций и перечни торговых наименований. НЕ использован для показаний/доз (сводка прямо предупреждает о непригодности для решений).
- **Deprioritized:** rlsnet.ru/drugs/sertralin-91507 — описание отсутствует в БД РЛС; бесполезно.
- **Deprioritized:** grls.pharm-portal.ru (зеркало ГРЛС) — подтвердило только номер РУ и упаковки; навигация/поиск нерабочие.
- **Rejected:** sprosivracha.com (вопрос №3414758) — формулировка «не рекомендуется с СИОЗС» без ссылки на инструкцию; противоречит дословному тексту инструкции Авиандра.
- **Rejected:** rxedu.ru, minutkoclinic.com, medum.ru, calcengines.com, medicalculators.online — SEO/вторичные, без первичных ссылок.

## Next steps
1. Прямая сверка по ГРЛС (grls.rosminzdrav.ru) текущих РУ и утверждённых инструкций для: Сертралин (Фармпроект), Золофт, Эсциталопрам (Пранафарм), Ципралекс, Авиандр — включая PDF-версии.
2. Уточнить у держателя РУ/по актуальной инструкции: интервал сертралин→МАО (7 vs 14 дней) и наличие QT-противопоказания у эсциталопрама в РФ-редакции.
3. Проверить наличие 25 мг сертралина в ГРЛС и полный перечень дозировок Ципралекса.
