"""Clinical application module.

    from apps.api.clinic import Clinical, MemoryStore, Actor, Role

Nine methods, one seam. See docs/api-design.md for why this shape and what was
rejected.
"""

from .clinical import Clinical
from .errors import ErrorKind, Rejected
from .memory import MemoryStore
from .ports import Catalog, Drafter, PatientBundle, PatientState, Screener, Store
from .types import (
    Actor, Advice, Alert, AlertState, Appointment, AppointmentDraft, Assessment,
    Assignment, AuditEntry, Card, CaseFile, Feed, Message, Obligation, Patient,
    PatientRow, Plan, Prescription, Queue, Referral, Response, Role, ScoreView,
    SignalKey, SignalRow,
)

__all__ = [
    "Actor", "Advice", "Alert", "AlertState", "Appointment", "AppointmentDraft",
    "Assessment", "Assignment", "AuditEntry", "Card", "CaseFile", "Catalog",
    "Clinical", "Drafter", "ErrorKind", "Feed", "MemoryStore", "Message",
    "Obligation", "Patient", "PatientBundle", "PatientRow", "PatientState", "Plan",
    "Prescription", "Queue", "Referral", "Rejected", "Response", "Role", "ScoreView",
    "Screener", "SignalKey", "SignalRow", "Store",
]
