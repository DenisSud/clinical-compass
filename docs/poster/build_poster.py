#!/usr/bin/env python3
"""Собирает постер А1 (594×842 мм, PDF) о прототипе «Клинического компаса».

Содержание держим здесь же, чтобы постер правился одним файлом. Всё, что
помечено `[?]`, — не факт из репозитория, а место, куда нужен ответ Дениса.

    python3 build_poster.py --out /path/to/poster.pdf --fonts /path/to/fonts

Шрифты: DejaVuSans.ttf и DejaVuSans-Bold.ttf (в них есть кириллица).
"""

from __future__ import annotations

import argparse
from pathlib import Path

from reportlab.lib.colors import Color, black
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.platypus import Frame, KeepTogether, Paragraph, Table, TableStyle

PAGE_W = 594 * mm
PAGE_H = 842 * mm  # как в требованиях; А1 по ГОСТ — 594×841

MARGIN = 24 * mm
COL_GAP = 13 * mm

INK = Color(0.07, 0.07, 0.08)
MUTED = Color(0.36, 0.36, 0.38)
HAIR = Color(0.72, 0.72, 0.74)
PANEL = Color(0.955, 0.95, 0.94)

# --- содержание -------------------------------------------------------------

KICKER = "КЕЙС-ЧЕМПИОНАТ · КОМАНДА 6-И"
TITLE = "КЛИНИЧЕСКИЙ КОМПАС"
SUBTITLE = "Цифровой ассистент врача при тревожно-депрессивной симптоматике"
META = (
    "Партнёр кейса — ГК ХимРар / ООО «Авинейро», препарат-якорь «Авиандр» · "
    "прототип — веб-сервис на TypeScript: Fastify 5, SQLite, React 19"
)

SECTION_1 = {
    "title": "1. Идея и решение кейса",
    "paras": [
        "Врач не-психиатр первым встречает тревожно-депрессивную симптоматику. На приёме "
        "нет времени ни на развёрнутую оценку, ни на сверку с клинической рекомендацией, "
        "ни на то, чтобы вовремя заметить, что пациента пора передавать психиатру.",
        "«Клинический компас» собирает данные между приёмами: ежедневная отметка "
        "самочувствия, PHQ-9 раз в две недели, отметки о приёме препарата, сообщение врачу. "
        "Система поднимает по правилам сигналы, врач разбирает каждый и записывает результат. "
        "План лечения пациент видит только после подтверждения врачом.",
    ],
    "lead": "Три ограничения, которые держим как правило продукта:",
    "bullets": [
        "<b>Сигнал — вопрос врачу, а не указание.</b> Система не назначает и не отменяет "
        "терапию: граница «черновик / действие» задана типом в контракте, а не промптом.",
        "<b>Пациент не видит интерпретаций.</b> Ни балла, ни диапазона, ни тренда, ни слов "
        "«хуже» и «лучше» — только собственные ответы и даты.",
        "<b>Сбой не выглядит как пустота.</b> «Не удалось загрузить» и «данных нет» — "
        "разные утверждения и разные экраны.",
    ],
}

SECTION_2 = {
    "title": "2. Прототип: что удалось сделать",
    "bullets": [
        "<b>Один процесс, один порт.</b> Fastify 5 отдаёт API и собранный SPA, Drizzle и "
        "SQLite хранят данные, React 19 и Vite — интерфейс. 40 HTTP-маршрутов, 10 таблиц "
        "(ADR-0001).",
        "<b>Две роли и связь.</b> Сессии и роли, привязка пациента к ведущему врачу по коду, "
        "изоляция данных между врачами, отвязка.",
        "<b>Шкалы как данные.</b> JSON-движок инструментов: версия, критические пункты, "
        "диапазоны. Новая шкала — новый файл, ядро не меняется.",
        "<b>Наблюдение.</b> Ежедневный дневник, недельный опросник, серия и тренд у врача.",
        "<b>Сигналы.</b> Критический пункт PHQ-9, тяжёлый балл, резкое падение, ухудшение; "
        "поверх встроенных — правила самого врача. Критический пункт отключить нельзя.",
        "<b>Разбор сигнала.</b> «Взять в работу» → результат → закрытие. Без результата "
        "сигнал не закрывается.",
        "<b>Дальше по контуру.</b> План с подтверждением, приверженность (принял / пропустил / "
        "нет отметки), тред врач ↔ пациент, демо-данные.",
        "<b>Рекомендации.</b> Карточки из корпуса (ОХЛП «Авиандра») называют основание и "
        "пробелы; нет источника — система говорит, чего не хватает, вместо догадки. Модель "
        "вынесена за интерфейс ClinicalAssistant: шов объявлен, реализации нет.",
    ],
}

FUNCTIONS_TITLE = "Функции кейса: что покрыто прототипом сегодня"
FUNCTIONS = [
    ("1", "Стандартизованная оценка", "есть", "PHQ-9 файлом: 9 пунктов, 5 диапазонов, критический пункт q9"),
    ("2", "Рекомендации со ссылкой на источник", "частично", "карточки и основания есть; в корпусе один ОХЛП, клинрекомендаций нет"),
    ("3", "Риски и нежелательные явления", "частично", "текст ОХЛП в корпусе; проверки доз и взаимодействий нет"),
    ("4", "Мониторинг динамики", "есть", "дневник, история шкал, тренд"),
    ("5", "Интерфейс пациента", "есть", "дневник, PHQ-9, сообщения врачу"),
    ("6", "Каналы коммуникации", "есть", "асинхронный тред пациент ↔ врач"),
    ("7", "Приверженность лечению", "есть", "отметки приёма и три состояния у врача"),
    ("8", "Эскалация к психиатру", "частично", "тяжесть и сигналы есть; явного действия «направить» нет"),
]

SECTION_4 = {
    "title": "3. Результаты испытания и метрики",
    "lead": (
        "Замеры на этом прототипе, 28.10.2026: локальный стенд, 16 параллельных пациентов, "
        "вымышленные данные. Клиническая эффективность не измерялась."
    ),
    "bullets": [
        "<b>Логика.</b> 130 автотестов в 15 наборах: правила сигналов, изоляция доступа, "
        "привязка, повторная отправка.",
        "<b>Доставка сигнала.</b> Критический пункт PHQ-9 → сигнал у врача за 2 мс (p95), "
        "12 из 12 замеров.",
        "<b>Устойчивость.</b> 1920 запросов: p50 3,5 мс, p95 8,9 мс, 0 ответов 5xx; кривой "
        "ввод — 100 запросов, 0 ответов 5xx.",
        "<b>Падение процесса.</b> SIGKILL: 0 потерь из 20 сигналов, подъём за 359 мс — RPO 0 "
        "для подтверждённых записей.",
        "<b>Доступ.</b> 13 попыток чужого врача и чужого пациента — 0 утечек.",
        "<b>Обоснованность.</b> 1 из 1 карточки рекомендаций с основанием и ссылкой на ОХЛП.",
        "<b>Расширяемость и объём.</b> Новая шкала — 1 файл данных, 0 строк кода. 5000 "
        "опросников в базе — карточка истории 11,6 мс.",
        "<b>Не измерено:</b> удобство врача (действия и время на задачу) и извлечение из выписок.",
    ],
}

SECTION_5 = {
    "title": "4. Дальнейшие предложения и планы",
    "items": [
        "<b>Модель на шов ClinicalAssistant</b> — черновики резюме, заключения и карточек; "
        "детерминированный слой без LLM в критическом пути (метрика 1).",
        "<b>Корпус знаний:</b> клинрекомендации Минздрава, ССRI и правила «Авиандра» как "
        "данные (метрики 2, 5, 10).",
        "<b>Функция 3:</b> реестр нежелательных явлений, проверка дозы и взаимодействий по ОХЛП.",
        "<b>Функция 8:</b> явное «направить к психиатру» — действие врача с фиксацией в карточке.",
        "<b>Шкалы:</b> подтвердить русскоязычную валидацию PHQ-9 или заменить шкалу (issue #1).",
        "<b>Пилот:</b> 5–8 врачей на 3 клинических сценариях; время и число действий на "
        "маршруте «пациент отправил PHQ-9 → врач разобрал сигнал» (критерий 3, метрика 4).",
        "<b>Эксплуатация и UI-долг:</b> нагрузочный прогон 50–100 RPS, RPO/RTO, outbox для "
        "алертов, индексы (метрики 6, 7, 11), контур под 152-ФЗ; критический сигнал громче "
        "кода привязки (DESIGN.md §2.3).",
    ],
}

FOOTER_TITLE = "5. Команда проекта, благодарности, QR"
TEAM_TITLE = "Команда 6-И"
TEAM = [
    "Наталья — трекер команды",
    "Александр Гусарев",
    "Илья Иващенко — ГК ХимРар",
    "@stoton — шкалы, клиническая часть",
    "@Tzezt",
    "Антон — макет",
    "Денис Судаков — разработка",
]
TEAM_NOTE = "[?] состав и роли — подтвердить"

THANKS_TITLE = "Благодарности"
THANKS = (
    "ГК ХимРар и ООО «Авинейро» — за кейс и тексты инструкций. Трекеру Наталье — за "
    "разбор задачи. Организаторам чемпионата — за формат, в котором честный прототип "
    "весит больше отполированного слайда."
)

QR_NOTE = "[?] QR: ссылка"
QR_CAPTION = "на демо"

QUOTE = "Система предлагает и спрашивает. Решает и подписывает врач."
QUOTE_NOTE = "Правило из GLOSSARY.md: черновик не имеет клинического эффекта до подтверждения врачом."

SOURCES = (
    "Источники: ОХЛП «АВИАНДР», 20 мг (Единый реестр зарегистрированных лекарственных "
    "препаратов ЕАЭС, lk.regmed.ru, снято 23.10.2026) · PHQ-9 — Spitzer R.L., Williams J.B.W., "
    "Kroenke K., public domain · замеры: scripts/metrics/run.mjs, 28.10.2026"
)


# --- сборка -----------------------------------------------------------------

def register_fonts(fonts: Path) -> None:
    pdfmetrics.registerFont(TTFont("Body", str(fonts / "DejaVuSans.ttf")))
    pdfmetrics.registerFont(TTFont("Body-Bold", str(fonts / "DejaVuSans-Bold.ttf")))
    pdfmetrics.registerFontFamily("Body", normal="Body", bold="Body-Bold")


def styles(body: float, leading: float, heading: float):
    return {
        "body": ParagraphStyle(
            "body", fontName="Body", fontSize=body, leading=leading, textColor=INK,
            spaceAfter=body * 0.55,
        ),
        "bullet": ParagraphStyle(
            "bullet", fontName="Body", fontSize=body, leading=leading, textColor=INK,
            leftIndent=body * 0.95, bulletIndent=0, spaceAfter=body * 0.5,
            bulletFontName="Body", bulletFontSize=body,
        ),
        "number": ParagraphStyle(
            "number", fontName="Body", fontSize=body, leading=leading, textColor=INK,
            leftIndent=body * 1.25, bulletIndent=0, spaceAfter=body * 0.5,
        ),
        "heading": ParagraphStyle(
            "heading", fontName="Body-Bold", fontSize=heading, leading=heading * 1.12,
            textColor=INK, spaceBefore=heading * 0.25, spaceAfter=heading * 0.45,
        ),
    }


def section_flow(section, st, *, numbered: bool = False):
    flow = [Paragraph(section["title"], st["heading"])]
    for para in section.get("paras", []):
        flow.append(Paragraph(para, st["body"]))
    if section.get("lead"):
        flow.append(Paragraph(section["lead"], st["body"]))
    for index, text in enumerate(section.get("bullets", []), start=1):
        if numbered:
            flow.append(Paragraph(text, st["number"], bulletText=f"{index}."))
        else:
            flow.append(Paragraph(text, st["bullet"], bulletText="•"))
    for index, text in enumerate(section.get("items", []), start=1):
        flow.append(Paragraph(text, st["number"], bulletText=f"{index}."))
    return flow


def draw_header(c: canvas.Canvas, st) -> float:
    """Рисует шапку сверху вниз, возвращает y (в pt от низа), где кончилась шапка."""
    y = PAGE_H - MARGIN
    c.setFillColor(MUTED)
    c.setFont("Body", 16)
    c.drawString(MARGIN, y - 16, KICKER)
    y -= 16 + 26

    c.setFillColor(INK)
    c.setFont("Body-Bold", 96)
    c.drawString(MARGIN, y - 76, TITLE)
    y -= 76 + 30

    c.setFont("Body", 31)
    c.setFillColor(INK)
    c.drawString(MARGIN, y - 31, SUBTITLE)
    y -= 31 + 20

    c.setFont("Body", 17)
    c.setFillColor(MUTED)
    c.drawString(MARGIN, y - 17, META)
    y -= 17 + 20

    c.setStrokeColor(INK)
    c.setLineWidth(2.4)
    c.line(MARGIN, y, PAGE_W - MARGIN, y)
    return y


def draw_functions(c: canvas.Canvas, top: float, st) -> float:
    """Полоса «8 функций кейса»: 4 колонки × 2 строки."""
    width = PAGE_W - 2 * MARGIN
    c.setFillColor(INK)
    c.setFont("Body-Bold", 26)
    c.drawString(MARGIN, top - 26, FUNCTIONS_TITLE)
    y = top - 26 - 22
    c.setStrokeColor(HAIR)
    c.setLineWidth(1)
    c.line(MARGIN, y, PAGE_W - MARGIN, y)

    cols, row_h = 4, 116
    cell_w = (width - (cols - 1) * COL_GAP) / cols
    for index, (number, name, status, note) in enumerate(FUNCTIONS):
        col, row = index % cols, index // cols
        x = MARGIN + col * (cell_w + COL_GAP)
        cell_top = y - row * row_h

        c.setFillColor(MUTED)
        c.setFont("Body-Bold", 13)
        c.drawString(x, cell_top - 20, number)

        c.setFillColor(INK)
        c.setFont("Body-Bold", 19)
        for offset, line in enumerate(wrap(name, "Body-Bold", 19, cell_w - 18)):
            c.drawString(x + 18, cell_top - 20 - offset * 22, line)

        c.setFont("Body", 14.5)
        c.setFillColor(MUTED)
        status_y = cell_top - 20 - len(wrap(name, "Body-Bold", 19, cell_w - 18)) * 22 - 2
        c.drawString(x + 18, status_y, status.upper())
        c.setFillColor(INK)
        c.setFont("Body", 14)
        for offset, line in enumerate(wrap(note, "Body", 14, cell_w - 18)[:3]):
            c.drawString(x + 18, status_y - 20 - offset * 17, line)
    return y - 2 * row_h - 10


FOOTER_H = 300


def draw_footer(c: canvas.Canvas, bottom: float) -> None:
    width = PAGE_W - 2 * MARGIN
    qr_side = 140
    top = bottom + FOOTER_H

    c.setStrokeColor(INK)
    c.setLineWidth(1.6)
    c.line(MARGIN, top, PAGE_W - MARGIN, top)

    c.setFillColor(INK)
    c.setFont("Body-Bold", 24)
    c.drawString(MARGIN, top - 30, FOOTER_TITLE)

    team_w = width * 0.33
    thanks_x = MARGIN + team_w + COL_GAP
    thanks_w = width - team_w - qr_side - 2 * COL_GAP
    head_y = top - 30 - 34

    # команда
    c.setFillColor(MUTED)
    c.setFont("Body-Bold", 13)
    c.drawString(MARGIN, head_y + 16, TEAM_TITLE.upper())
    c.setFillColor(INK)
    c.setFont("Body", 16)
    y = head_y
    for name in TEAM:
        c.drawString(MARGIN, y, name)
        y -= 19
    c.setFillColor(MUTED)
    c.setFont("Body", 12.5)
    c.drawString(MARGIN, y - 6, TEAM_NOTE)

    # благодарности
    c.setFillColor(MUTED)
    c.setFont("Body-Bold", 13)
    c.drawString(thanks_x, head_y + 16, THANKS_TITLE.upper())
    c.setFillColor(INK)
    c.setFont("Body", 15.5)
    for offset, line in enumerate(wrap(THANKS, "Body", 15.5, thanks_w)):
        c.drawString(thanks_x, head_y - offset * 21, line)

    # QR
    qr_x = PAGE_W - MARGIN - qr_side
    qr_top = head_y + 22
    c.setStrokeColor(MUTED)
    c.setLineWidth(1)
    c.setDash(5, 5)
    c.rect(qr_x, qr_top - qr_side, qr_side, qr_side)
    c.setDash()
    c.setFillColor(MUTED)
    c.setFont("Body", 10)
    c.drawCentredString(qr_x + qr_side / 2, qr_top - qr_side / 2 + 4, QR_NOTE)
    c.drawCentredString(qr_x + qr_side / 2, qr_top - qr_side / 2 - 9, QR_CAPTION)

    # источники
    c.setFillColor(MUTED)
    c.setFont("Body", 12)
    for offset, line in enumerate(wrap(SOURCES, "Body", 12, width - qr_side - COL_GAP)):
        c.drawString(MARGIN, bottom + 26 - offset * 15, line)


def draw_callout(c: canvas.Canvas, x: float, bottom: float, width: float) -> None:
    pad = 22
    quote_lines = wrap(QUOTE, "Body-Bold", 22, width - 2 * pad)
    note_lines = wrap(QUOTE_NOTE, "Body", 13.5, width - 2 * pad)
    height = pad + len(quote_lines) * 28 + 10 + len(note_lines) * 17 + pad - 4

    c.setFillColor(PANEL)
    c.setStrokeColor(HAIR)
    c.setLineWidth(1)
    c.rect(x, bottom, width, height, stroke=1, fill=1)

    c.setFillColor(INK)
    c.setFont("Body-Bold", 22)
    y = bottom + height - pad - 20
    for line in quote_lines:
        c.drawString(x + pad, y, line)
        y -= 28
    c.setFillColor(MUTED)
    c.setFont("Body", 13.5)
    y -= 6
    for line in note_lines:
        c.drawString(x + pad, y, line)
        y -= 17


def wrap(text: str, font: str, size: float, width: float) -> list[str]:
    words, lines, current = text.split(" "), [], ""
    for word in words:
        trial = f"{current} {word}".strip()
        if pdfmetrics.stringWidth(trial, font, size) <= width or not current:
            current = trial
        else:
            lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines


def build(out: Path, fonts: Path) -> dict:
    register_fonts(fonts)
    c = canvas.Canvas(str(out), pagesize=(PAGE_W, PAGE_H))
    c.setTitle("Клинический компас — постер А1")
    c.setAuthor("Команда 6-И")

    body, leading, heading = 20.2, 28.0, 30
    st = styles(body, leading, heading)

    c.setFillColor(Color(1, 1, 1))
    c.rect(0, 0, PAGE_W, PAGE_H, stroke=0, fill=1)

    header_bottom = draw_header(c, st)
    footer_top = MARGIN + FOOTER_H

    band_h = 52 + 2 * 116 + 10
    band_bottom = footer_top + 24
    band_top = band_bottom + band_h
    draw_functions(c, band_top, st)

    story = []
    story += section_flow(SECTION_1, st)
    story += section_flow(SECTION_2, st)
    story += section_flow(SECTION_4, st)
    story += section_flow(SECTION_5, st)

    area_top, area_bottom = header_bottom - 34, band_top + 22
    area_h = area_top - area_bottom
    width = PAGE_W - 2 * MARGIN
    col_w = (width - 2 * COL_GAP) / 3

    report = {"columns": []}
    for col in range(3):
        x = MARGIN + col * (col_w + COL_GAP)
        frame = Frame(x, area_bottom, col_w, area_h, leftPadding=0, rightPadding=0,
                      topPadding=0, bottomPadding=0, showBoundary=0)
        frame.addFromList(story, c)
        report["columns"].append(round((frame._y - frame._y1) / mm, 1))
    report["leftover_flowables"] = len(story)
    if story:
        report["leftover_preview"] = [str(getattr(item, "text", item))[:90] for item in story]
    draw_callout(c, MARGIN + 2 * (col_w + COL_GAP), area_bottom, col_w)

    draw_footer(c, MARGIN)
    c.showPage()
    c.save()
    report["page_mm"] = (round(PAGE_W / mm), round(PAGE_H / mm))
    report["fonts_embedded"] = sorted(pdfmetrics.getRegisteredFontNames())
    return report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, default=Path("poster-a1.pdf"))
    parser.add_argument("--fonts", type=Path, default=Path(__file__).parent / "fonts")
    args = parser.parse_args()
    report = build(args.out, args.fonts)
    print("→", args.out)
    for key, value in report.items():
        print(f"  {key}: {value}")


if __name__ == "__main__":
    main()
