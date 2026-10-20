"""Deterministic insight: no model, no database, no wall clock."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest

from compass.insights import RELIABLE_CHANGE, adherence, analyse, build
from compass.instruments import load_strict

AT = datetime(2026, 10, 20, 9, 0, tzinfo=timezone.utc)
REGISTRY = load_strict()


class R:
    """A response, standing in for the stored type."""

    def __init__(self, code: str, at: datetime, answers: dict) -> None:
        self.instrument_code = code
        self.submitted_at = at
        self.answers = answers
        self.definition_sha256 = REGISTRY.get(code).sha256


def phq9(at: datetime, total: int) -> R:
    """Answers that sum to ``total`` without tripping the safety item."""
    answers = {f"q{i}": 0 for i in range(1, 10)}
    left = total
    for key in ("q1", "q2", "q3", "q4", "q5", "q6", "q7", "q8"):
        take = min(3, left)
        answers[key] = take
        left -= take
    return R("PHQ9-RU", at, answers)


def daily(at: datetime, mood: int = 1) -> R:
    return R("WELLBEING-DAILY", at, {"mood": mood, "sleep": 1, "anxiety": 1,
                                     "energy": 1, "harm": 0})


def test_a_daily_check_never_produces_a_band_or_a_change_finding():
    series = build([daily(AT - timedelta(days=3), 0), daily(AT, 3)], REGISTRY)
    assert [s.kind for s in series] == ["daily_check"]
    assert series[0].latest.band_label is None
    findings = analyse(series, now=AT)
    assert all(f.code not in {"notable_band", "worsened"} for f in findings)


def test_a_total_in_a_notable_band_is_reported_with_its_source():
    series = build([phq9(AT, 17)], REGISTRY)
    findings = analyse(series, now=AT)
    band = next(f for f in findings if f.code == "notable_band")
    assert "PHQ9-RU" in band.source
    assert band.detail


def test_the_change_threshold_is_ours_and_says_so():
    series = build([phq9(AT - timedelta(days=7), 8), phq9(AT, 8 + RELIABLE_CHANGE)], REGISTRY)
    finding = next(f for f in analyse(series, now=AT) if f.code == "worsened")
    assert "не из руководства" in finding.source


def test_a_small_change_is_not_reported():
    series = build([phq9(AT - timedelta(days=7), 8), phq9(AT, 8 + RELIABLE_CHANGE - 1)], REGISTRY)
    assert all(f.code != "worsened" for f in analyse(series, now=AT))


def test_an_old_series_is_reported_as_stale_rather_than_reassuring():
    series = build([phq9(AT - timedelta(days=40), 6)], REGISTRY)
    findings = analyse(series, now=AT)
    assert any(f.code == "stale" for f in findings)


def test_a_response_from_an_older_definition_is_skipped_not_rescored():
    class Changed(R):
        def __init__(self, *a, **k):
            super().__init__(*a, **k)
            self.definition_sha256 = "0" * 64

    old = Changed("PHQ9-RU", AT, {f"q{i}": 0 for i in range(1, 10)})
    assert build([old], REGISTRY) == ()


def test_incomplete_answers_leave_no_total():
    answers = {f"q{i}": 0 for i in range(1, 10)}
    answers["q4"] = None
    series = build([R("PHQ9-RU", AT, answers)], REGISTRY)
    assert series[0].latest.total is None
    assert any(f.code == "incomplete" for f in analyse(series, now=AT))


def test_adherence_counts_distinct_days_in_the_window():
    responses = [daily(AT - timedelta(days=n)) for n in range(0, 7)]
    series = build(responses, REGISTRY)
    report = adherence(series[0], AT, window_days=14)
    assert (report.filled, report.expected) == (7, 14)
    assert report.ratio == pytest.approx(0.5)


def test_low_adherence_is_its_own_finding():
    series = build([daily(AT)], REGISTRY)
    report = adherence(series[0], AT, window_days=14)
    findings = analyse(series, daily_adherence=report, now=AT)
    assert any(f.code == "low_adherence" for f in findings)


def test_findings_are_ordered_worst_first():
    series = build([phq9(AT - timedelta(days=7), 6), phq9(AT, 20)], REGISTRY)
    findings = analyse(series, now=AT)
    severities = [int(f.severity) for f in findings]
    assert severities == sorted(severities)
