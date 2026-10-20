"""Triage: merging deterministic rules with a small model's opinion.

The rule this module exists to enforce:

    **A model may raise attention. It may never lower it.**

Mandatory condition 3 of the case says the system must not act clinically on its
own. So instrument-derived findings (PHQ-9 item 9 above zero, a missing answer)
are authoritative; decision-model output is a *candidate* that goes into the same
review queue with a lower rank and its confidence attached for the human to
weigh.

The decision model is a 2.7B classifier. Its 93% is not a calibrated probability
and it will be wrong on sarcasm, negation and Russian colloquial negation in
particular. Treat it as a cheap second pair of eyes, never as the gate.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import IntEnum
from typing import Iterable, Sequence

from compass.instruments import Score

from .ollama import Decision, Ollama, OllamaError

#: Binary screens the decision model runs over free patient text. Each is a
#: question a clinician would ask of a message, phrased to be answerable yes/no.
SCREENS: tuple[tuple[str, str], ...] = (
    ("suicide_risk", "Does the text mention suicidal thoughts, self-harm, or a wish to be dead?"),
    ("self_harm_plan", "Does the text describe a concrete plan or intent to harm oneself?"),
    ("severe_side_effect", "Does the text describe a severe or dangerous reaction to a medication?"),
    ("stopped_medication", "Does the text say the patient stopped or skipped their medication?"),
    ("worsening", "Does the text say the patient's condition has become worse?"),
)

#: Message routing, for the support-request category.
MESSAGE_CATEGORIES: dict[str, str] = {
    "question": "A clinical question to the doctor",
    "organization": "An administrative or scheduling question",
    "report": "A clarification about a self-report the patient already sent",
    "adherence": "A problem taking medication as prescribed",
    "side_effect": "A side effect the patient is experiencing",
}

#: Urgency levels, mapped to the review queue.
URGENCY_LEVELS = ("Routine", "Soon", "Immediate")


class Rank(IntEnum):
    """Ordering of a review item. Higher is more urgent."""

    INFO = 10
    SOON = 20
    URGENT = 30


@dataclass(frozen=True)
class Candidate:
    """Something worth a human look, with its provenance stated."""

    signal: str
    origin: str  # "instrument" | "decision_model"
    rank: Rank
    authoritative: bool
    reason: str
    confidence: int | None = None

    @property
    def label(self) -> str:
        return {
            "suicide_risk_item": "Пункт 9 PHQ-9 выше нуля",
            "suicide_risk_unanswered": "Пункт 9 PHQ-9 без ответа",
            "suicide_risk": "Возможны суицидальные мысли (модель)",
            "self_harm_plan": "Возможен план самоповреждения (модель)",
            "severe_side_effect": "Возможна тяжёлая нежелательная реакция (модель)",
            "stopped_medication": "Возможен пропуск приёма препарата (модель)",
            "worsening": "Возможное ухудшение состояния (модель)",
        }.get(self.signal, self.signal)


def from_instrument(score: Score) -> list[Candidate]:
    """Deterministic findings. These are authoritative."""
    out: list[Candidate] = []
    for finding in score.findings:
        rank = Rank.URGENT if finding.signal.startswith("suicide") else Rank.SOON
        out.append(
            Candidate(
                signal=finding.signal,
                origin="instrument",
                rank=rank,
                authoritative=True,
                reason=finding.reason,
            )
        )
    # A total in the severe band is itself worth surfacing, even without item 9.
    primary = score.primary
    if primary.total is not None and primary.severity in {"severe", "moderately_severe", "clinical"}:
        out.append(
            Candidate(
                signal="severe_score",
                origin="instrument",
                rank=Rank.SOON,
                authoritative=True,
                reason=f"{score.code}: {primary.label} = {primary.total} ({primary.band_label})",
            )
        )
    return out


def screen_text(ollama: Ollama, text: str) -> list[Candidate]:
    """Run the binary screens over patient-supplied free text.

    Never raises: a model that is down must not block saving a patient message.
    Failures are reported as an informational candidate so the gap is visible
    rather than silent.
    """
    text = text.strip()
    if not text:
        return []

    out: list[Candidate] = []
    errors: list[str] = []
    for signal, question in SCREENS:
        try:
            decision = ollama.decide(question, text)
        except OllamaError as exc:
            errors.append(f"{signal}: {exc}")
            continue
        if decision.is_yes:
            # Confidence scales the rank but never promotes a model candidate
            # above an authoritative instrument finding.
            rank = Rank.URGENT if (signal.startswith("suicide") or signal == "self_harm_plan") and decision.confidence >= 80 else Rank.SOON
            out.append(
                Candidate(
                    signal=signal,
                    origin="decision_model",
                    rank=rank,
                    authoritative=False,
                    reason=f"{question} — модель: {decision.label} {decision.confidence}%",
                    confidence=decision.confidence,
                )
            )

    if errors:
        out.append(
            Candidate(
                signal="screen_unavailable",
                origin="decision_model",
                rank=Rank.INFO,
                authoritative=False,
                reason="Скрининг текста недоступен: " + "; ".join(errors[:3]),
            )
        )
    return out


def urgency(ollama: Ollama, text: str) -> Decision | None:
    """Ordinal urgency for one message. ``None`` when the model is unavailable."""
    if not text.strip():
        return None
    try:
        return ollama.decide("How urgent is this patient message?", text, levels=URGENCY_LEVELS)
    except OllamaError:
        return None


def categorise(ollama: Ollama, text: str) -> Decision | None:
    """Route a patient message into a support-request category."""
    if not text.strip():
        return None
    try:
        return ollama.decide("What is this message about?", text, choices=MESSAGE_CATEGORIES)
    except OllamaError:
        return None


def merge(*groups: Iterable[Candidate]) -> list[Candidate]:
    """Combine candidate groups, authoritative first, then by rank."""
    merged = [c for group in groups for c in group]
    merged.sort(key=lambda c: (not c.authoritative, -int(c.rank), c.signal))
    return merged


def highest(candidates: Sequence[Candidate]) -> Candidate | None:
    return candidates[0] if candidates else None


__all__ = [
    "MESSAGE_CATEGORIES",
    "SCREENS",
    "URGENCY_LEVELS",
    "Candidate",
    "Rank",
    "categorise",
    "from_instrument",
    "highest",
    "merge",
    "screen_text",
    "urgency",
]
