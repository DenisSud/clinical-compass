"""Triage: merging deterministic rules with a small model's opinion.

The rule this module exists to enforce:

    **A model may raise attention. It may never lower it.**

Mandatory condition 3 of the case says the system must not act clinically on its
own. So a model candidate is never the *gate*: it cannot close a case, cannot
clear a flag, and cannot be the sole trigger for anything that changes treatment.

Ranking needs **two independent axes**, not one:

``Severity``
    What could happen to the patient. A property of the *signal*, identical
    whichever origin found it. Possible suicidality outranks a high total score
    no matter who noticed.

``authoritative``
    How we know. A scaled instrument or a drug label is verified; a 2.7B
    classifier is a suspicion. This changes wording and appearance, and it is a
    tie-break within a severity band — it never moves a signal into a lower band,
    because demoting on provenance is just lowering attention with extra steps.

The first version of this module sorted by provenance first, which pushed a
model-detected side effect below an authoritative mild score. That reads as
"the machine is sure" when it means "the questionnaire was filled in".

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
    """How loudly this item wants to be seen. Higher is louder."""

    INFO = 10
    SOON = 20
    URGENT = 30


class Severity(IntEnum):
    """What could happen to the patient. Lower is worse.

    Independent of who found the signal. A model's *suspicion* of suicidal
    ideation sits in the same band as a questionnaire's confirmation of it; only
    the wording and the visual treatment differ.
    """

    CRITICAL = 0  # risk to life: suicidal ideation, self-harm plan
    DANGER = 1  # dangerous reaction, contraindication, a severe verified total
    ATTENTION = 2  # worsening, non-adherence, a moderate score
    INFO = 3  # the system could not screen, or nothing actionable


#: Signal name -> severity band. One table so that a new signal cannot be added
#: without deciding how bad it is.
SEVERITY_BY_SIGNAL: dict[str, Severity] = {
    "suicide_risk_item": Severity.CRITICAL,
    "suicide_risk_unanswered": Severity.CRITICAL,
    "suicide_risk": Severity.CRITICAL,
    "self_harm_plan": Severity.CRITICAL,
    # A direct report on the daily check. Not a scale, but the patient's own words
    # about today — the most actionable thing on the screen.
    "self_harm_today": Severity.CRITICAL,
    "severe_side_effect": Severity.DANGER,
    "contraindication": Severity.DANGER,
    "serotonin_syndrome_risk": Severity.DANGER,
    "severe_score": Severity.ATTENTION,
    "worsening": Severity.ATTENTION,
    "stopped_medication": Severity.ATTENTION,
    "screen_unavailable": Severity.INFO,
}


def severity_of(signal: str) -> Severity:
    """Severity for ``signal``; unknown signals are treated as attention-worthy.

    Defaulting to ATTENTION rather than INFO is deliberate: a signal nobody
    classified should not silently sink to the bottom.
    """
    return SEVERITY_BY_SIGNAL.get(signal, Severity.ATTENTION)


@dataclass(frozen=True)
class Candidate:
    """Something worth a human look, with its provenance stated."""

    signal: str
    origin: str  # "instrument" | "decision_model"
    rank: Rank
    authoritative: bool
    reason: str
    confidence: int | None = None
    #: Set when the band must be finer than the signal name alone. ``None`` means
    #: "look it up in SEVERITY_BY_SIGNAL".
    severity_override: Severity | None = None

    @property
    def severity(self) -> Severity:
        return severity_of(self.signal) if self.severity_override is None else self.severity_override

    @property
    def label(self) -> str:
        return {
            "suicide_risk_item": "Пункт 9 PHQ-9 выше нуля",
            "suicide_risk_unanswered": "Пункт 9 PHQ-9 без ответа",
            "suicide_risk": "Возможны суицидальные мысли (модель)",
            "self_harm_plan": "Возможен план самоповреждения (модель)",
            "self_harm_today": "Сегодня были мысли навредить себе",
            "severe_side_effect": "Возможна тяжёлая нежелательная реакция (модель)",
            "stopped_medication": "Возможен пропуск приёма препарата (модель)",
            "worsening": "Возможное ухудшение состояния (модель)",
            "severe_score": "Тяжёлый балл по шкале",
            "definition_changed": "Шкала изменилась после заполнения",
        }.get(self.signal, self.signal)


def from_instrument(score: Score) -> list[Candidate]:
    """Deterministic findings. These are authoritative."""
    out: list[Candidate] = []
    for finding in score.findings:
        urgent = finding.signal.startswith(("suicide", "self_harm"))
        rank = Rank.URGENT if urgent else Rank.SOON
        reason = finding.reason
        severity: Severity | None = None

        # A skipped item 9 and an abandoned form are not the same situation.
        # Item 9 is the last item: answering eight of nine and leaving item 9 out
        # is a decision, and it is the more concerning one. Abandoning at item 2
        # means nobody ever asked. Treating both as critical would flood the
        # queue with the single most common patient behaviour — one-item-per-screen
        # plus "leaving is always allowed" guarantees abandonments.
        if finding.signal == "suicide_risk_unanswered" and score.completed < score.required - 1:
            severity = Severity.ATTENTION
            reason = f"Заполнение прервано ({score.completed} из {score.required}): до пункта 9 не дошли"

        out.append(
            Candidate(
                signal=finding.signal,
                origin="instrument",
                rank=rank,
                authoritative=True,
                reason=reason,
                severity_override=severity,
            )
        )

    # A total in the severe band is itself worth surfacing, even without item 9.
    # Rank rather than severity carries the difference: a verified total of 27 and
    # a verified total of 10 are both "attention", but they must not sort equally.
    # Keeping totals out of the DANGER band matters — a score is a severity
    # descriptor, not an event, and it should not compete with an adverse reaction.
    primary = score.primary
    if primary.total is not None and primary.severity in {"severe", "moderately_severe", "clinical"}:
        top_band = primary.severity in {"severe", "clinical"}
        out.append(
            Candidate(
                signal="severe_score",
                origin="instrument",
                rank=Rank.URGENT if top_band else Rank.SOON,
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
            # Parentheses matter: `and` binds tighter than `or`, so without them a
            # suicide screen at 51% would be URGENT on the strength of its name
            # alone. Confidence scales the rank, but rank still never promotes a
            # model candidate into a different severity band.
            urgent = (signal.startswith("suicide") or signal == "self_harm_plan") and decision.confidence >= 80
            out.append(
                Candidate(
                    signal=signal,
                    origin="decision_model",
                    rank=Rank.URGENT if urgent else Rank.SOON,
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
    """Combine candidate groups into review order.

    Sort key, in order of precedence:

    1. **severity** — what could happen to the patient, whoever noticed it;
    2. **authoritative** — within a band, verified findings lead suspicions;
    3. **rank** — how loudly the item wants to be seen;
    4. **signal** — stable tie-break so the queue does not reshuffle on its own.

    Note what is *not* here: arrival time. ``merge`` is a pure function over
    candidates and knows nothing about clocks. The queue layer applies arrival as
    a stable tie-break inside a tier; the display must not claim otherwise.
    """
    merged = [c for group in groups for c in group]
    merged.sort(key=lambda c: (int(c.severity), not c.authoritative, -int(c.rank), c.signal))
    return merged


def highest(candidates: Sequence[Candidate]) -> Candidate | None:
    return candidates[0] if candidates else None


__all__ = [
    "MESSAGE_CATEGORIES",
    "SCREENS",
    "SEVERITY_BY_SIGNAL",
    "URGENCY_LEVELS",
    "Candidate",
    "Rank",
    "Severity",
    "categorise",
    "from_instrument",
    "highest",
    "merge",
    "screen_text",
    "severity_of",
    "urgency",
]
