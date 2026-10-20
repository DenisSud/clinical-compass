"""SQLite adapter for the store port.

SQLite serialises writers process-wide, so a write transaction is genuinely
atomic here — that is what the signature gate needs — but it offers no per-row
concurrency. That is an acceptable trade for a demo and a poor one for a clinic.

The schema is written so the Postgres adapter can reuse the same shape: no
SQLite-specific types, timestamps as ISO text, complex values as JSON.
"""

from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime
from typing import Any, Iterator

from compass.ai.triage import Candidate, Rank, Severity

from .ports import PatientBundle, PatientState
from .types import (
    Alert, AlertState, Appointment, Assignment, AuditEntry, Message, Obligation,
    Patient, Plan, Prescription, Referral, Response, SignalKey,
)

SCHEMA = """
CREATE TABLE IF NOT EXISTS patients (
  id TEXT PRIMARY KEY, display TEXT NOT NULL, birth_year INTEGER NOT NULL,
  doctor_id TEXT, linked_since TEXT, profile TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS assignments (
  id TEXT PRIMARY KEY, patient_id TEXT NOT NULL, instrument_code TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS responses (
  id TEXT PRIMARY KEY, assignment_id TEXT NOT NULL, patient_id TEXT NOT NULL,
  instrument_code TEXT NOT NULL, definition_sha256 TEXT NOT NULL,
  answers TEXT NOT NULL, submitted_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY, patient_id TEXT NOT NULL, doctor_id TEXT NOT NULL,
  revision INTEGER NOT NULL, signature TEXT NOT NULL, complaint TEXT NOT NULL,
  prescriptions TEXT NOT NULL, referral TEXT, plan TEXT NOT NULL,
  signed_at TEXT NOT NULL, published TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY, patient_id TEXT NOT NULL, author_id TEXT NOT NULL,
  direction TEXT NOT NULL, text TEXT NOT NULL, at TEXT NOT NULL,
  screened TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS alerts (
  patient_id TEXT NOT NULL, signal TEXT NOT NULL, source TEXT NOT NULL,
  item TEXT NOT NULL, state TEXT NOT NULL, at TEXT NOT NULL, actor_id TEXT NOT NULL,
  note TEXT NOT NULL, evidence_label TEXT NOT NULL, evidence_reason TEXT NOT NULL,
  evidence_severity INTEGER NOT NULL,
  PRIMARY KEY (patient_id, signal, source, item)
);
CREATE TABLE IF NOT EXISTS audit (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, actor_id TEXT NOT NULL,
  patient_id TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS idem (
  key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_responses_patient ON responses(patient_id, submitted_at);
CREATE INDEX IF NOT EXISTS ix_appointments_patient ON appointments(patient_id);
CREATE INDEX IF NOT EXISTS ix_messages_patient ON messages(patient_id);
CREATE INDEX IF NOT EXISTS ix_audit_patient ON audit(patient_id);
"""


# ------------------------------------------------------------------ codecs


def _iso(value: datetime) -> str:
    return value.isoformat()


def _dt(value: str) -> datetime:
    return datetime.fromisoformat(value)


def _candidates_dump(items: tuple[Candidate, ...]) -> str:
    return json.dumps([
        {
            "signal": c.signal, "origin": c.origin, "rank": int(c.rank),
            "authoritative": c.authoritative, "reason": c.reason,
            "confidence": c.confidence,
            "severity_override": int(c.severity_override) if c.severity_override is not None else None,
        }
        for c in items
    ])


def _candidates_load(raw: str) -> tuple[Candidate, ...]:
    return tuple(
        Candidate(
            signal=d["signal"], origin=d["origin"], rank=Rank(d["rank"]),
            authoritative=d["authoritative"], reason=d["reason"],
            confidence=d["confidence"],
            severity_override=Severity(d["severity_override"]) if d["severity_override"] is not None else None,
        )
        for d in json.loads(raw)
    )


def _prescriptions_dump(items: tuple[Prescription, ...]) -> str:
    return json.dumps([p.__dict__ for p in items])


def _prescriptions_load(raw: str) -> tuple[Prescription, ...]:
    return tuple(Prescription(**d) for d in json.loads(raw))


def _referral_dump(referral: Referral | None) -> str | None:
    if referral is None:
        return None
    return json.dumps({"kind": referral.kind, "obligation": referral.obligation.value,
                       "criteria": list(referral.criteria)})


def _referral_load(raw: str | None) -> Referral | None:
    if raw is None:
        return None
    d = json.loads(raw)
    return Referral(d["kind"], Obligation(d["obligation"]), tuple(d["criteria"]))


def _plan_dump(plan: Plan) -> str:
    return json.dumps({"next_visit_on": plan.next_visit_on.isoformat() if plan.next_visit_on else None,
                       "notes": plan.notes})


def _plan_load(raw: str) -> Plan:
    d = json.loads(raw)
    from datetime import date
    return Plan(date.fromisoformat(d["next_visit_on"]) if d["next_visit_on"] else None, d["notes"])


# ------------------------------------------------------------------ adapter


class SqliteStore:
    def __init__(self, path: str = ":memory:") -> None:
        # isolation_level=None: transactions are opened explicitly, so a unit of
        # work is visible in the code rather than implied by the driver.
        self._db = sqlite3.connect(path, isolation_level=None)
        self._db.row_factory = sqlite3.Row
        self._db.execute("PRAGMA foreign_keys = ON")
        self._db.executescript(SCHEMA)

    # ------------------------------------------------------- transactions

    @contextmanager
    def unit_of_work(self) -> Iterator[None]:
        if self._db.in_transaction:
            self._db.execute("SAVEPOINT uow")
            try:
                yield
            except BaseException:
                self._db.execute("ROLLBACK TO uow")
                raise
            else:
                self._db.execute("RELEASE uow")
        else:
            self._db.execute("BEGIN IMMEDIATE")
            try:
                yield
            except BaseException:
                self._db.execute("ROLLBACK")
                raise
            else:
                self._db.execute("COMMIT")

    # -------------------------------------------------------------- setup

    def add_patient(self, patient: Patient) -> None:
        self._db.execute(
            "INSERT OR REPLACE INTO patients VALUES (?,?,?,?,?,?)",
            (patient.id, patient.display, patient.birth_year, patient.doctor_id,
             _iso(patient.linked_since) if patient.linked_since else None,
             json.dumps(dict(patient.profile))),
        )

    def add_assignment(self, assignment: Assignment) -> None:
        self._db.execute(
            "INSERT OR REPLACE INTO assignments VALUES (?,?,?,?)",
            (assignment.id, assignment.patient_id, assignment.instrument_code,
             _iso(assignment.created_at)),
        )

    # -------------------------------------------------------------- reads

    def _patient(self, row: sqlite3.Row) -> Patient:
        return Patient(
            id=row["id"], display=row["display"], birth_year=row["birth_year"],
            doctor_id=row["doctor_id"],
            linked_since=_dt(row["linked_since"]) if row["linked_since"] else None,
            profile=json.loads(row["profile"]),
        )

    @staticmethod
    def _response(row: sqlite3.Row) -> Response:
        return Response(
            id=row["id"], assignment_id=row["assignment_id"], patient_id=row["patient_id"],
            instrument_code=row["instrument_code"],
            definition_sha256=row["definition_sha256"],
            answers=json.loads(row["answers"]), submitted_at=_dt(row["submitted_at"]),
        )

    @staticmethod
    def _message(row: sqlite3.Row) -> Message:
        return Message(
            id=row["id"], patient_id=row["patient_id"], author_id=row["author_id"],
            direction=row["direction"], text=row["text"], at=_dt(row["at"]),
            screened=_candidates_load(row["screened"]),
        )

    @staticmethod
    def _alert(row: sqlite3.Row) -> Alert:
        return Alert(
            key=SignalKey(row["patient_id"], row["signal"], row["source"], row["item"]),
            state=AlertState(row["state"]), at=_dt(row["at"]), actor_id=row["actor_id"],
            note=row["note"], evidence_label=row["evidence_label"],
            evidence_reason=row["evidence_reason"],
            evidence_severity=Severity(row["evidence_severity"]),
        )

    @staticmethod
    def _appointment(row: sqlite3.Row) -> Appointment:
        return Appointment(
            id=row["id"], patient_id=row["patient_id"], doctor_id=row["doctor_id"],
            revision=row["revision"], signature=row["signature"],
            complaint=row["complaint"],
            prescriptions=_prescriptions_load(row["prescriptions"]),
            referral=_referral_load(row["referral"]), plan=_plan_load(row["plan"]),
            signed_at=_dt(row["signed_at"]),
            published=frozenset(json.loads(row["published"])),
        )

    def doctor_patients(self, doctor_id: str) -> tuple[PatientBundle, ...]:
        out = []
        for row in self._db.execute(
            "SELECT * FROM patients WHERE doctor_id = ? ORDER BY id", (doctor_id,)
        ):
            patient = self._patient(row)
            latest = self._db.execute(
                "SELECT * FROM responses WHERE patient_id = ? "
                "ORDER BY submitted_at DESC LIMIT 1", (patient.id,)
            ).fetchone()
            messages = tuple(
                self._message(m) for m in self._db.execute(
                    "SELECT * FROM messages WHERE patient_id = ? ORDER BY at", (patient.id,)
                )
            )
            alerts = tuple(
                self._alert(a) for a in self._db.execute(
                    "SELECT * FROM alerts WHERE patient_id = ?", (patient.id,)
                )
            )
            contacts = [m.at for m in messages] + ([_dt(latest["submitted_at"])] if latest else [])
            out.append(
                PatientBundle(
                    patient=patient,
                    latest_response=self._response(latest) if latest else None,
                    messages=messages,
                    alerts=alerts,
                    last_contact_at=max(contacts) if contacts else None,
                )
            )
        return tuple(out)

    def patient_state(self, patient_id: str) -> PatientState | None:
        row = self._db.execute("SELECT * FROM patients WHERE id = ?", (patient_id,)).fetchone()
        if row is None:
            return None
        return PatientState(
            patient=self._patient(row),
            responses=tuple(
                self._response(r) for r in self._db.execute(
                    "SELECT * FROM responses WHERE patient_id = ? ORDER BY submitted_at",
                    (patient_id,))
            ),
            appointments=tuple(
                self._appointment(a) for a in self._db.execute(
                    "SELECT * FROM appointments WHERE patient_id = ? ORDER BY revision",
                    (patient_id,))
            ),
            messages=tuple(
                self._message(m) for m in self._db.execute(
                    "SELECT * FROM messages WHERE patient_id = ? ORDER BY at", (patient_id,))
            ),
            alerts=tuple(
                self._alert(a) for a in self._db.execute(
                    "SELECT * FROM alerts WHERE patient_id = ?", (patient_id,))
            ),
            audit=self.audit_of(patient_id),
        )

    def assignment(self, assignment_id: str) -> Assignment | None:
        row = self._db.execute(
            "SELECT * FROM assignments WHERE id = ?", (assignment_id,)
        ).fetchone()
        if row is None:
            return None
        return Assignment(row["id"], row["patient_id"], row["instrument_code"],
                          _dt(row["created_at"]))

    def appointment(self, appointment_id: str) -> Appointment | None:
        row = self._db.execute(
            "SELECT * FROM appointments WHERE id = ?", (appointment_id,)
        ).fetchone()
        return self._appointment(row) if row else None

    def message(self, message_id: str) -> Message | None:
        row = self._db.execute("SELECT * FROM messages WHERE id = ?", (message_id,)).fetchone()
        return self._message(row) if row else None

    def audit_of(self, patient_id: str) -> tuple[AuditEntry, ...]:
        return tuple(
            AuditEntry(r["seq"], _dt(r["at"]), r["actor_id"], r["patient_id"],
                       r["action"], r["detail"])
            for r in self._db.execute(
                "SELECT * FROM audit WHERE patient_id = ? ORDER BY seq", (patient_id,))
        )

    def idem_get(self, key: str) -> tuple[str, dict[str, Any]] | None:
        row = self._db.execute("SELECT * FROM idem WHERE key = ?", (key,)).fetchone()
        return (row["fingerprint"], json.loads(row["payload"])) if row else None

    # ------------------------------------------------------------- writes

    def replace_appointment(self, appointment: Appointment) -> None:
        self.append_appointment(appointment)

    def append_appointment(self, appointment: Appointment) -> None:
        self._db.execute(
            "INSERT OR REPLACE INTO appointments VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (appointment.id, appointment.patient_id, appointment.doctor_id,
             appointment.revision, appointment.signature, appointment.complaint,
             _prescriptions_dump(appointment.prescriptions),
             _referral_dump(appointment.referral), _plan_dump(appointment.plan),
             _iso(appointment.signed_at), json.dumps(sorted(appointment.published))),
        )

    def append_response(self, response: Response) -> None:
        self._db.execute(
            "INSERT OR REPLACE INTO responses VALUES (?,?,?,?,?,?,?)",
            (response.id, response.assignment_id, response.patient_id,
             response.instrument_code, response.definition_sha256,
             json.dumps(dict(response.answers)), _iso(response.submitted_at)),
        )

    def append_message(self, message: Message) -> None:
        self._db.execute(
            "INSERT OR REPLACE INTO messages VALUES (?,?,?,?,?,?,?)",
            (message.id, message.patient_id, message.author_id, message.direction,
             message.text, _iso(message.at), _candidates_dump(message.screened)),
        )

    def save_alert(self, alert: Alert) -> None:
        self._db.execute(
            "INSERT OR REPLACE INTO alerts VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (alert.key.patient_id, alert.key.signal, alert.key.source, alert.key.item,
             alert.state.value, _iso(alert.at), alert.actor_id, alert.note,
             alert.evidence_label, alert.evidence_reason, int(alert.evidence_severity)),
        )

    def append_audit(self, entry: AuditEntry) -> int:
        cursor = self._db.execute(
            "INSERT INTO audit (at, actor_id, patient_id, action, detail) VALUES (?,?,?,?,?)",
            (_iso(entry.at), entry.actor_id, entry.patient_id, entry.action, entry.detail),
        )
        return int(cursor.lastrowid or 0)

    def idem_put(self, key: str, fingerprint: str, payload: dict) -> None:
        self._db.execute(
            "INSERT OR REPLACE INTO idem VALUES (?,?,?)",
            (key, fingerprint, json.dumps(payload)),
        )


__all__ = ["SqliteStore"]
