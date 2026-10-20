"""Ports at the clinical seam.

Coarse on purpose: two projections aligned to the two hot methods, plus one write
per fact. Fine-grained repositories would push transaction boundaries out into
callers and multiply round trips on exactly the read that cannot afford them.

Two adapters exist for ``Store`` — SQLite and in-memory — and one contract suite
runs against both. That is what makes it a seam rather than indirection.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from contextlib import AbstractContextManager
from typing import Protocol

from compass.ai.triage import Candidate

from .types import (
    Actor, Alert, Appointment, Assignment, AuditEntry, Message, Patient, Response,
    Visit,
)


@dataclass(frozen=True)
class PatientBundle:
    """Everything the queue needs about one patient, in one read."""

    patient: Patient
    latest_response: Response | None
    #: Every answer, because a safety signal is an event, not current state.
    responses: tuple[Response, ...]
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
    visits: tuple[Visit, ...] = ()


class Store(Protocol):
    def unit_of_work(self) -> AbstractContextManager[None]:
        """One atomic unit. The signature gate covers six writes, not one.

        Nothing outside this block is rolled back, so validation must finish
        before entering it.
        """
        ...

    def doctor_patients(self, doctor_id: str) -> tuple[PatientBundle, ...]: ...
    def patient_state(self, patient_id: str) -> PatientState | None: ...
    def assignment(self, assignment_id: str) -> Assignment | None: ...
    def assignments_of(self, patient_id: str) -> tuple[Assignment, ...]: ...
    def visits_of_patient(self, patient_id: str) -> tuple[Visit, ...]: ...
    def visits_of_doctor(self, doctor_id: str) -> tuple[Visit, ...]: ...
    def appointment(self, appointment_id: str) -> Appointment | None: ...
    def message(self, message_id: str) -> Message | None: ...
    def replace_appointment(self, appointment: Appointment) -> None: ...
    def append_response(self, response: Response) -> None: ...
    def append_appointment(self, appointment: Appointment) -> None: ...
    def append_message(self, message: Message) -> None: ...
    def append_assignment(self, assignment: Assignment) -> None: ...
    def append_visit(self, visit: Visit) -> None: ...
    def save_alert(self, alert: Alert) -> None: ...
    def append_audit(self, entry: AuditEntry) -> int: ...
    def audit_of(self, patient_id: str) -> tuple[AuditEntry, ...]: ...
    def idem_get(self, key: str) -> tuple[str, dict] | None:
        """Return (content fingerprint, JSON-safe receipt payload)."""
        ...

    def idem_put(self, key: str, fingerprint: str, payload: dict) -> None:
        """Store a receipt, not a domain object — a database can hold this."""
        ...


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
