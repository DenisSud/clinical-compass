"""Value types at the clinical seam.

Two rules govern this file and are enforced by the shapes rather than by reviews:

* a clinical field exists only on a type that a signature produces;
* patient-facing types have no field capable of holding a score, a band or a
  severity. ``Card`` is not a filtered ``CaseFile`` — it cannot carry one.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from enum import Enum
from typing import Mapping

from compass.ai.triage import Candidate, Rank, Severity


class Role(str, Enum):
    DOCTOR = "doctor"
    PATIENT = "patient"


class Obligation(str, Enum):
    """How binding a referral is. A separate axis from verified/suspected."""

    OBLIGATORY = "obligatory"
    DESIRABLE = "desirable"


class AlertState(str, Enum):
    SEEN = "seen"
    ACKNOWLEDGED = "acknowledged"
    RESOLVED = "resolved"


@dataclass(frozen=True)
class Actor:
    """Who is calling. Names a person; grants nothing.

    Authority is re-derived from the care link on every call, so a forged role in
    a session cannot widen scope.
    """

    id: str
    role: Role


# ---------------------------------------------------------------- people


@dataclass(frozen=True)
class Patient:
    id: str
    display: str
    birth_year: int
    doctor_id: str | None = None
    linked_since: datetime | None = None
    #: Facts the rule engine may read. Kept deliberately small: a rule can only
    #: see what is in the profile, which is why a new rule touches no caller.
    profile: Mapping[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class Assignment:
    id: str
    patient_id: str
    instrument_code: str
    created_at: datetime


@dataclass(frozen=True)
class Response:
    """A submitted questionnaire. Answers only — the score is derived on read."""

    id: str
    assignment_id: str
    patient_id: str
    instrument_code: str
    definition_sha256: str
    answers: Mapping[str, int | None]
    submitted_at: datetime


@dataclass(frozen=True)
class Assessment:
    """What a patient gets back. Procedural, by construction: no score field."""

    accepted: bool
    response_id: str
    submitted_at: datetime


@dataclass(frozen=True)
class Message:
    id: str
    patient_id: str
    author_id: str
    direction: str  # "to_doctor" | "to_patient"
    text: str
    at: datetime
    #: Model output captured at write time, never recomputed on read.
    screened: tuple[Candidate, ...] = ()


# ---------------------------------------------------------------- signals


@dataclass(frozen=True, order=True)
class SignalKey:
    """Stable identity of a finding. Survives restarts and rule edits."""

    patient_id: str
    signal: str
    source: str  # "instrument" | "decision_model" | "rule"
    item: str = ""


@dataclass(frozen=True)
class SignalRow:
    key: SignalKey
    label: str
    reason: str
    severity: Severity
    authoritative: bool
    rank: Rank
    obligation: Obligation | None = None
    waiting_since: datetime | None = None
    more: int = 0  # further signals on the same patient, not shown


@dataclass(frozen=True)
class PatientRow:
    patient_id: str
    display: str
    age: int
    linked_days: int | None
    last_contact_at: datetime | None


@dataclass(frozen=True)
class Queue:
    revision: str
    attention: tuple[SignalRow, ...]
    others: tuple[PatientRow, ...]
    new_criticals: int
    #: True when the caller's ``since_revision`` still describes this order.
    stable: bool = False


@dataclass(frozen=True)
class Alert:
    key: SignalKey
    state: AlertState
    at: datetime
    actor_id: str
    note: str = ""
    #: What the screen showed when it was acted on. Frozen so history stays
    #: readable after the rule that produced it changes.
    evidence_label: str = ""
    evidence_reason: str = ""
    evidence_severity: Severity = Severity.INFO


# ---------------------------------------------------------------- the card


@dataclass(frozen=True)
class ScoreView:
    """A verified score. Doctor-facing only — no patient type can hold this."""

    instrument_code: str
    version: str
    total: int | None
    band_label: str | None
    severity: str | None
    completed: int
    required: int
    at: datetime


@dataclass(frozen=True)
class Card:
    """One item in the patient's feed. Procedural or doctor-authored only."""

    kind: str  # "assignment" | "published" | "message"
    title: str
    body: str = ""
    at: datetime | None = None
    ref_id: str = ""


@dataclass(frozen=True)
class Feed:
    cards: tuple[Card, ...]


@dataclass(frozen=True)
class CaseFile:
    patient: Patient
    scores: tuple[ScoreView, ...]
    signals: tuple[SignalRow, ...]
    medications: tuple[str, ...]
    alerts: tuple[Alert, ...]
    thread: tuple[Message, ...]
    last_appointment_at: datetime | None


# ---------------------------------------------------------------- therapy


@dataclass(frozen=True)
class Prescription:
    drug_code: str
    dose: str
    schedule: str
    course_days: int | None = None


@dataclass(frozen=True)
class Referral:
    kind: str  # "psychiatrist"
    obligation: Obligation
    criteria: tuple[str, ...] = ()


@dataclass(frozen=True)
class Plan:
    next_visit_on: date | None = None
    notes: str = ""


@dataclass(frozen=True)
class AppointmentDraft:
    patient_id: str
    signature: str
    complaint: str = ""
    prescriptions: tuple[Prescription, ...] = ()
    referral: Referral | None = None
    plan: Plan = field(default_factory=Plan)
    acknowledged: tuple[SignalKey, ...] = ()
    expected_revision: str | None = None


@dataclass(frozen=True)
class Appointment:
    id: str
    patient_id: str
    doctor_id: str
    revision: int
    signature: str
    # A follow-up with no complaint and no change of therapy is the normal case,
    # not an edge case; make the type say so.
    complaint: str = ""
    prescriptions: tuple[Prescription, ...] = ()
    referral: Referral | None = None
    plan: Plan = field(default_factory=Plan)
    signed_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    published: frozenset[str] = frozenset()


@dataclass(frozen=True)
class Advice:
    """A model suggestion. Never clinical state; never signed."""

    answer: str | None
    citations: tuple[str, ...]
    degraded: bool
    reason: str = ""


@dataclass(frozen=True)
class AuditEntry:
    seq: int
    at: datetime
    actor_id: str
    patient_id: str
    action: str
    detail: str = ""


__all__ = [
    "Actor", "Advice", "Alert", "AlertState", "Appointment", "AppointmentDraft",
    "Assessment", "Assignment", "AuditEntry", "Card", "CaseFile", "Feed", "Message",
    "Obligation", "Patient", "PatientRow", "Plan", "Prescription", "Queue", "Referral",
    "Response", "Role", "ScoreView", "SignalKey", "SignalRow",
]
