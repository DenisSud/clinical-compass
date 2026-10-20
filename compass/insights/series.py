"""Series construction and the rules that read it.

Everything here is a pure function of responses, so a test needs no database and
no clock it does not pass in.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Iterable, Mapping, Sequence

from compass.ai.triage import Rank, Severity
from compass.instruments import Instrument, Registry, score

#: Points of change that we treat as worth remarking on.
#:
#: This is **our** threshold, not one taken from our source corpus. Five points on
#: a 27-point scale is the change usually described as clinically meaningful in
#: the literature on PHQ-9, but we have not yet verified a passage for it in
#: docs/sources, so the source string says so out loud. Replace with a citation
#: before anyone repeats this number in a report.
RELIABLE_CHANGE = 5

#: Bands that mean "this person is currently unwell, not borderline".
_NOTABLE_BANDS = {"moderately_severe", "severe"}

#: After this long without a weekly answer, the series is stale rather than short.
STALE_AFTER = timedelta(days=14)

#: Below this share of expected daily ticks, the picture is incomplete.
LOW_ADHERENCE = 0.5


def points_word(count: int) -> str:
    """«1 балл», «3 балла», «10 баллов» — Russian needs all three."""
    if count % 10 == 1 and count % 100 != 11:
        return "балл"
    if count % 10 in (2, 3, 4) and count % 100 not in (12, 13, 14):
        return "балла"
    return "баллов"


@dataclass(frozen=True)
class Point:
    at: datetime
    instrument_code: str
    total: int | None
    maximum: int
    band_label: str | None
    severity: str | None
    complete: bool


@dataclass(frozen=True)
class Series:
    instrument_code: str
    title: str
    kind: str
    points: tuple[Point, ...]

    @property
    def latest(self) -> Point | None:
        return self.points[-1] if self.points else None

    @property
    def previous(self) -> Point | None:
        return self.points[-2] if len(self.points) > 1 else None

    @property
    def maximum(self) -> int:
        return self.latest.maximum if self.latest else 0


@dataclass(frozen=True)
class Adherence:
    """How much of the expected daily log actually exists."""

    filled: int
    expected: int

    @property
    def ratio(self) -> float:
        return 1.0 if self.expected <= 0 else self.filled / self.expected


@dataclass(frozen=True)
class Finding:
    code: str
    severity: Severity
    rank: Rank
    title: str
    detail: str
    #: Where the number came from: a definition, a rule we wrote, or a guideline.
    source: str


# ------------------------------------------------------------------ building


def build(
    responses: Iterable[object], registry: Registry
) -> tuple[Series, ...]:
    """Group scored responses into one series per instrument, oldest first.

    A response whose definition has changed is skipped rather than re-scored: its
    total under today's rules would be a different number wearing the same label.
    """
    grouped: dict[str, list[Point]] = {}
    titles: dict[str, tuple[str, str]] = {}
    for response in sorted(responses, key=lambda r: r.submitted_at):  # type: ignore[attr-defined]
        code = response.instrument_code  # type: ignore[attr-defined]
        if code not in registry:
            continue
        instrument = registry.get(code)
        if instrument.sha256 != response.definition_sha256:  # type: ignore[attr-defined]
            continue
        result = score(instrument, response.answers)  # type: ignore[attr-defined]
        primary = result.primary
        grouped.setdefault(code, []).append(
            Point(
                at=response.submitted_at,  # type: ignore[attr-defined]
                instrument_code=code,
                total=primary.total,
                maximum=maximum_of(instrument),
                band_label=primary.band_label,
                severity=primary.severity,
                complete=result.complete,
            )
        )
        titles[code] = (instrument.short, instrument.kind)
    return tuple(
        Series(code, titles[code][0], titles[code][1], tuple(points))
        for code, points in sorted(grouped.items())
    )


def maximum_of(instrument: Instrument) -> int:
    """Highest reachable total for the scored subscale."""
    first = instrument.subscales[0]
    keys = first.items if first.items is not None else instrument.item_keys
    return sum(
        max(option.points for option in instrument.options_for(key)) for key in keys
    )


def adherence(
    daily: Series | None, now: datetime, window_days: int = 14,
    zone: timezone | object = timezone.utc,
) -> Adherence:
    """Count distinct days with an entry, against the days the window expects.

    ``zone`` matters: a tick at 01:00 in Moscow is the previous day in UTC, and
    counting it against the wrong day would quietly shrink the denominator.
    """
    if daily is None:
        return Adherence(0, window_days)
    since = now - timedelta(days=window_days)
    days = {p.at.astimezone(zone).date() for p in daily.points if p.at >= since}
    return Adherence(len(days), window_days)


# ------------------------------------------------------------------ analysis


def analyse(
    series: Sequence[Series],
    *,
    daily_adherence: Adherence | None = None,
    now: datetime,
) -> tuple[Finding, ...]:
    """Rules over the series. Ordered by severity, most consequential first."""
    findings: list[Finding] = []
    for one in series:
        if one.kind != "validated_scale":
            continue
        findings.extend(_band(one))
        findings.extend(_change(one))
        findings.extend(_freshness(one, now))
        findings.extend(_completeness(one))
    findings.extend(_adherence(daily_adherence) if daily_adherence else ())
    return tuple(sorted(findings, key=lambda f: (int(f.severity), -int(f.rank), f.code)))


def _band(series: Series) -> list[Finding]:
    latest = series.latest
    if latest is None or latest.severity not in _NOTABLE_BANDS:
        return []
    return [
        Finding(
            code="notable_band",
            severity=Severity.ATTENTION,
            rank=Rank.URGENT,
            title=f"{series.title}: {latest.total} из {latest.maximum}",
            detail=latest.band_label or "",
            source=f"{series.instrument_code} (полоса шкалы)",
        )
    ]


def _change(series: Series) -> list[Finding]:
    latest, previous = series.latest, series.previous
    if latest is None or previous is None:
        return []
    if latest.total is None or previous.total is None:
        return []
    delta = latest.total - previous.total
    if abs(delta) < RELIABLE_CHANGE:
        return []
    grew = delta > 0
    return [
        Finding(
            code="worsened" if grew else "improved",
            severity=Severity.ATTENTION if grew else Severity.INFO,
            rank=Rank.URGENT if grew else Rank.SOON,
            title=(
                f"{series.title}: {'рост' if grew else 'снижение'} на "
                f"{abs(delta)} {points_word(abs(delta))}"
            ),
            detail=f"с {previous.total} до {latest.total}",
            source=f"наш порог {RELIABLE_CHANGE} баллов, не из руководства",
        )
    ]


def _freshness(series: Series, now: datetime) -> list[Finding]:
    latest = series.latest
    if latest is None:
        return [
            Finding(
                code="no_data",
                severity=Severity.ATTENTION,
                rank=Rank.SOON,
                title=f"{series.title}: нет ни одного ответа",
                detail="динамики нет",
                source="правило: отсутствие данных",
            )
        ]
    if now - latest.at <= STALE_AFTER:
        return []
    days = (now - latest.at).days
    return [
        Finding(
            code="stale",
            severity=Severity.ATTENTION,
            rank=Rank.SOON,
            title=f"{series.title}: последний ответ {days} дн. назад",
            detail="текущее состояние неизвестно",
            source=f"наш порог {STALE_AFTER.days} дн., не из руководства",
        )
    ]


def _completeness(series: Series) -> list[Finding]:
    latest = series.latest
    if latest is None or latest.complete:
        return []
    return [
        Finding(
            code="incomplete",
            severity=Severity.INFO,
            rank=Rank.SOON,
            title=f"{series.title}: ответ неполный",
            detail="балл не рассчитан — unanswered не считается нулём",
            source="правило подсчёта шкалы",
        )
    ]


def _adherence(adherence_report: Adherence) -> list[Finding]:
    if adherence_report.ratio >= LOW_ADHERENCE:
        return []
    return [
        Finding(
            code="low_adherence",
            severity=Severity.ATTENTION,
            rank=Rank.SOON,
            title=(
                f"Дневник заполнен {adherence_report.filled} из "
                f"{adherence_report.expected} дней"
            ),
            detail="выводы о динамике ненадёжны",
            source="наше правило, не из руководства",
        )
    ]


__all__ = [
    "LOW_ADHERENCE",
    "points_word",
    "maximum_of",
    "RELIABLE_CHANGE",
    "STALE_AFTER",
    "Adherence",
    "Finding",
    "Point",
    "Series",
    "adherence",
    "analyse",
    "build",
]
