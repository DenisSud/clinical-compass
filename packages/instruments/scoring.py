"""Scoring: pure functions over a definition and a dict of answers.

Two rules that matter clinically and are easy to get wrong:

1. An unanswered item is *not* zero. ``None`` means "not answered"; a partially
   completed instrument yields no sum at all, rather than a falsely low score.
2. Safety signals are evaluated even when the instrument is incomplete. Item 9 of
   PHQ-9 answered "several days" is clinically actionable on its own.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping

from .definition import DefinitionError, Instrument, Subscale


@dataclass(frozen=True)
class SubscaleResult:
    key: str
    label: str
    total: int | None
    band_label: str | None
    severity: str | None
    complete: bool


@dataclass(frozen=True)
class SafetyFinding:
    signal: str
    item: str
    reason: str


@dataclass(frozen=True)
class Score:
    code: str
    version: str
    definition_sha256: str
    subscales: tuple[SubscaleResult, ...]
    completed: int
    required: int
    findings: tuple[SafetyFinding, ...]

    @property
    def complete(self) -> bool:
        return self.completed == self.required

    @property
    def primary(self) -> SubscaleResult:
        return self.subscales[0]


def score(instrument: Instrument, answers: Mapping[str, int | None]) -> Score:
    """Score ``answers`` against ``instrument``.

    ``answers`` must name every item exactly once; a missing key is a caller bug,
    while a ``None`` value is a legitimate "not answered".
    """
    unknown = set(answers) - set(instrument.item_keys)
    if unknown:
        raise DefinitionError(f"answers: unknown items {sorted(unknown)}")
    missing = set(instrument.item_keys) - set(answers)
    if missing:
        raise DefinitionError(f"answers: no entry for {sorted(missing)}")

    for key, value in answers.items():
        if value is None:
            continue
        if isinstance(value, bool) or not isinstance(value, int):
            raise DefinitionError(f"answers[{key}]: expected an int or None")
        allowed = {option.points for option in instrument.options_for(key)}
        if value not in allowed:
            raise DefinitionError(f"answers[{key}]: {value} is not a valid point value for {key}")

    completed = sum(value is not None for value in answers.values())
    results = tuple(_score_subscale(sub, answers) for sub in instrument.subscales)
    findings = tuple(_safety_findings(instrument, answers))
    return Score(
        code=instrument.code,
        version=instrument.version,
        definition_sha256=instrument.sha256,
        subscales=results,
        completed=completed,
        required=len(instrument.item_keys),
        findings=findings,
    )


def _score_subscale(sub: Subscale, answers: Mapping[str, int | None]) -> SubscaleResult:
    keys = sub.items if sub.items is not None else tuple(answers)
    values = [answers[k] for k in keys]
    if any(v is None for v in values):
        return SubscaleResult(sub.key, sub.label, None, None, None, False)
    total = sum(v for v in values if v is not None)
    band = _band(sub, total)
    return SubscaleResult(
        sub.key,
        sub.label,
        total,
        band.label if band else None,
        band.severity if band else None,
        True,
    )


def _band(sub: Subscale, total: int):
    for band in sub.bands:
        if total <= band.maximum:
            return band
    return None


def _safety_findings(instrument: Instrument, answers: Mapping[str, int | None]):
    for rule in instrument.safety:
        value = answers[rule.item]
        if rule.operator == "missing" and value is None:
            yield SafetyFinding(rule.signal, rule.item, rule.reason)
        elif rule.operator == "gt" and value is not None and value > rule.threshold:
            yield SafetyFinding(rule.signal, rule.item, rule.reason)
        elif rule.operator == "gte" and value is not None and value >= rule.threshold:
            yield SafetyFinding(rule.signal, rule.item, rule.reason)
        elif rule.operator == "eq" and value is not None and value == rule.threshold:
            yield SafetyFinding(rule.signal, rule.item, rule.reason)


__all__ = ["SafetyFinding", "Score", "SubscaleResult", "score"]
