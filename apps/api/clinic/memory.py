"""In-memory adapter for the store port.

Exists so the offline suite runs with no Postgres and no model. It is a real
adapter, not a stub: the same contract suite runs against it and against the
Postgres adapter, which is what makes the seam real rather than hypothetical.
"""

from __future__ import annotations

from datetime import datetime

from .ports import PatientBundle, PatientState
from .types import (
    Alert, Appointment, Assignment, AuditEntry, Message, Patient, Response,
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
        self.idem: dict[str, object] = {}
        self._seq = 0

    # ---------------------------------------------------------- setup

    def add_patient(self, patient: Patient) -> None:
        self.patients[patient.id] = patient

    def add_assignment(self, assignment: Assignment) -> None:
        self.assignments[assignment.id] = assignment

    # ---------------------------------------------------------- reads

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
        )

    def assignment(self, assignment_id: str) -> Assignment | None:
        return self.assignments.get(assignment_id)

    def appointment(self, appointment_id: str) -> Appointment | None:
        return self.appointments.get(appointment_id)

    def audit_of(self, patient_id: str) -> tuple[AuditEntry, ...]:
        return tuple(e for e in self.audit if e.patient_id == patient_id)

    def idem_get(self, key: str) -> object | None:
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

    def idem_put(self, key: str, value: object) -> None:
        self.idem[key] = value


__all__ = ["MemoryStore"]
