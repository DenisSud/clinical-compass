"""In-memory adapter for the store port.

Exists so the offline suite runs with no Postgres and no model. It is a real
adapter, not a stub: the same contract suite runs against it and against the
Postgres adapter, which is what makes the seam real rather than hypothetical.
"""

from __future__ import annotations

import copy
from contextlib import contextmanager
from datetime import datetime
from typing import Iterator

from .ports import PatientBundle, PatientState
from .types import (
    Alert, Appointment, Assignment, AuditEntry, Message, Patient, Response, Visit,
)


class MemoryStore:
    def __init__(self) -> None:
        self.patients: dict[str, Patient] = {}
        self.assignments: dict[str, Assignment] = {}
        self.responses: list[Response] = []
        self.appointments: dict[str, Appointment] = {}
        self.messages: list[Message] = []
        self.alerts: dict[tuple, Alert] = {}
        self.audit: list[AuditEntry] = []
        self.idem: dict[str, tuple[str, dict]] = {}
        self.visits: dict[str, Visit] = {}
        self._seq = 0

    # ---------------------------------------------------------- setup

    def add_patient(self, patient: Patient) -> None:
        self.patients[patient.id] = patient

    def add_assignment(self, assignment: Assignment) -> None:
        self.assignments[assignment.id] = assignment

    # ---------------------------------------------------------- reads

    @contextmanager
    def unit_of_work(self) -> Iterator[None]:
        """Snapshot and restore, so rollback is real here too.

        A test double that silently ignores rollback would let the suite pass on
        behaviour that production cannot honour. Deepcopy of eight containers is
        cheap at demo scale and keeps one contract for both adapters.
        """
        boxes = (self.patients, self.assignments, self.responses, self.appointments,
                 self.messages, self.alerts, self.audit, self.idem, self.visits,
                 self._seq)
        snapshot = copy.deepcopy(boxes)
        try:
            yield
        except BaseException:
            (self.patients, self.assignments, self.responses, self.appointments,
             self.messages, self.alerts, self.audit, self.idem, self.visits,
             self._seq) = snapshot
            raise

    def doctor_patients(self, doctor_id: str) -> tuple[PatientBundle, ...]:
        out = []
        for patient in self.patients.values():
            if patient.doctor_id != doctor_id:
                continue
            mine = [r for r in self.responses if r.patient_id == patient.id]
            latest = max(mine, key=lambda r: r.submitted_at) if mine else None
            msgs = tuple(m for m in self.messages if m.patient_id == patient.id)
            alerts = tuple(a for a in self.alerts.values() if a.key.patient_id == patient.id)
            contacts = [m.at for m in msgs] + ([latest.submitted_at] if latest else [])
            out.append(
                PatientBundle(
                    patient=patient,
                    latest_response=latest,
                    responses=tuple(sorted(mine, key=lambda r: r.submitted_at)),
                    messages=msgs,
                    alerts=alerts,
                    last_contact_at=max(contacts) if contacts else None,
                )
            )
        return tuple(out)

    def patient_state(self, patient_id: str) -> PatientState | None:
        patient = self.patients.get(patient_id)
        if patient is None:
            return None
        return PatientState(
            patient=patient,
            responses=tuple(r for r in self.responses if r.patient_id == patient_id),
            appointments=tuple(a for a in self.appointments.values() if a.patient_id == patient_id),
            messages=tuple(m for m in self.messages if m.patient_id == patient_id),
            alerts=tuple(a for a in self.alerts.values() if a.key.patient_id == patient_id),
            audit=tuple(e for e in self.audit if e.patient_id == patient_id),
            visits=self.visits_of_patient(patient_id),
        )

    def assignment(self, assignment_id: str) -> Assignment | None:
        return self.assignments.get(assignment_id)

    def assignments_of(self, patient_id: str) -> tuple[Assignment, ...]:
        return tuple(a for a in self.assignments.values() if a.patient_id == patient_id)

    def visits_of_patient(self, patient_id: str) -> tuple[Visit, ...]:
        return tuple(sorted(
            (v for v in self.visits.values() if v.patient_id == patient_id),
            key=lambda v: v.scheduled_at,
        ))

    def visits_of_doctor(self, doctor_id: str) -> tuple[Visit, ...]:
        return tuple(sorted(
            (v for v in self.visits.values() if v.doctor_id == doctor_id),
            key=lambda v: v.scheduled_at,
        ))

    def appointment(self, appointment_id: str) -> Appointment | None:
        return self.appointments.get(appointment_id)

    def message(self, message_id: str) -> Message | None:
        return next((m for m in self.messages if m.id == message_id), None)

    def audit_of(self, patient_id: str) -> tuple[AuditEntry, ...]:
        return tuple(e for e in self.audit if e.patient_id == patient_id)

    def idem_get(self, key: str) -> tuple[str, dict] | None:
        return self.idem.get(key)

    # ---------------------------------------------------------- writes

    def replace_appointment(self, appointment: Appointment) -> None:
        self.appointments[appointment.id] = appointment

    def append_response(self, response: Response) -> None:
        self.responses.append(response)

    def append_appointment(self, appointment: Appointment) -> None:
        self.appointments[appointment.id] = appointment

    def append_message(self, message: Message) -> None:
        self.messages.append(message)

    def append_assignment(self, assignment: Assignment) -> None:
        # Same uniqueness rule as the SQL adapter. Without it the module's claim
        # that "the adapter enforces one assignment per patient, instrument and
        # day" was true for exactly one of the two adapters.
        for existing in self.assignments.values():
            if (existing.patient_id, existing.instrument_code, existing.due_on) == (
                assignment.patient_id, assignment.instrument_code, assignment.due_on
            ):
                return
        self.assignments[assignment.id] = assignment

    def set_published(self, appointment_id: str, fields: frozenset[str]) -> None:
        import dataclasses

        appointment = self.appointments[appointment_id]
        self.appointments[appointment_id] = dataclasses.replace(
            appointment, published=fields
        )

    def append_visit(self, visit: Visit) -> None:
        self.visits[visit.id] = visit

    def save_alert(self, alert: Alert) -> None:
        self.alerts[(alert.key.patient_id, alert.key.signal, alert.key.source, alert.key.item)] = alert

    def append_audit(self, entry: AuditEntry) -> int:
        self._seq += 1
        self.audit.append(
            AuditEntry(
                seq=self._seq,
                at=entry.at,
                actor_id=entry.actor_id,
                patient_id=entry.patient_id,
                action=entry.action,
                detail=entry.detail,
            )
        )
        return self._seq

    def idem_put(self, key: str, fingerprint: str, payload: dict) -> None:
        self.idem[key] = (fingerprint, payload)


__all__ = ["MemoryStore"]
