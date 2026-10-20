"""Ports at the clinical seam.

Coarse on purpose: two projections aligned to the two hot methods, plus one write
per fact. Fine-grained repositories would push transaction boundaries out into
callers and multiply round trips on exactly the read that cannot afford them.

Two adapters are required for each of these to be a real seam: production and
in-memory. Where only one exists, it is indirection, and it is not here.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

from compass.ai.triage import Candidate

from .types import (
    Actor, Alert, Appointment, Assignment, AuditEntry, Message, Patient, Response,
)


@dataclass(frozen=True)
class PatientBundle:
    """Everything the queue needs about one patient, in one read."""

    patient: Patient
    latest_response: Response | None
    messages: tuple[Message, ...]
    alerts: tuple[Alert, ...]
    last_contact_at: datetime | None


@dataclass(frozen=True)
class PatientState:
    """Everything the card needs about one patient, in one read."""

    patient: Patient
    responses: tuple[Response, ...]
    appointments: tuple[Appointment, ...]
    messages: tuple[Message, ...]
    alerts: tuple[Alert, ...]
    audit: tuple[AuditEntry, ...]


class Store(Protocol):
    def doctor_patients(self, doctor_id: str) -> tuple[PatientBundle, ...]: ...
    def patient_state(self, patient_id: str) -> PatientState | None: ...
    def assignment(self, assignment_id: str) -> Assignment | None: ...
    def appointment(self, appointment_id: str) -> Appointment | None: ...
    def replace_appointment(self, appointment: Appointment) -> None: ...
    def append_response(self, response: Response) -> None: ...
    def append_appointment(self, appointment: Appointment) -> None: ...
    def append_message(self, message: Message) -> None: ...
    def save_alert(self, alert: Alert) -> None: ...
    def append_audit(self, entry: AuditEntry) -> int: ...
    def audit_of(self, patient_id: str) -> tuple[AuditEntry, ...]: ...
    def idem_get(self, key: str) -> object | None: ...
    def idem_put(self, key: str, value: object) -> None: ...


class Catalog(Protocol):
    """Registered drugs. Keyed on the trade name, not the INN.

    Condition 7 of the case grades "within the registered indications", and
    indications differ between trade names of the same INN. An INN-keyed catalog
    cannot represent that.
    """

    def validate(self, drug_code: str, dose: str) -> None:
        """Raise Rejected if the drug or the dose is not in its instruction."""
        ...


class Screener(Protocol):
    def __call__(self, text: str) -> tuple[Candidate, ...] | None:
        """Return candidates, or None when the model is unavailable."""
        ...


class Drafter(Protocol):
    def __call__(self, question: str, context: str) -> tuple[str | None, tuple[str, ...], str]:
        """Return (answer, citations, degraded_reason). Empty reason means fine."""
        ...


__all__ = ["Catalog", "Drafter", "PatientBundle", "PatientState", "Screener", "Store"]
