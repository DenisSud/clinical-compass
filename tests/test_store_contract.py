"""The store port has one contract, and every adapter must pass it.

Currently one adapter (memory). The Postgres adapter will be added as a second
parameter here — that is what turns the seam from indirection into a real seam,
so this file is the reason the port exists at all.
"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from apps.api.clinic import (
    Alert, AlertState, Assignment, AuditEntry, MemoryStore, Message, Patient,
    Response, SignalKey,
)
from compass.ai.triage import Severity

AT = datetime(2026, 10, 20, 9, 0, tzinfo=timezone.utc)


@pytest.fixture(params=["memory"])
def store(request):
    assert request.param == "memory"
    return MemoryStore()


def response(pid: str, at: datetime, total: int = 0) -> Response:
    return Response(
        id=f"r-{pid}-{at.minute}", assignment_id="a1", patient_id=pid,
        instrument_code="PHQ9-RU", definition_sha256="x",
        answers={"q1": total}, submitted_at=at,
    )


def test_append_audit_hands_out_strictly_increasing_sequence_numbers(store):
    def entry(action: str) -> AuditEntry:
        return AuditEntry(seq=0, at=AT, actor_id="d1", patient_id="p1", action=action)

    first = store.append_audit(entry("a"))
    second = store.append_audit(entry("b"))
    assert second > first
    assert [e.action for e in store.audit_of("p1")] == ["a", "b"]


def test_doctor_patients_returns_only_their_patients_with_the_latest_response(store):
    store.add_patient(Patient(id="p1", display="A", birth_year=1980, doctor_id="d1"))
    store.add_patient(Patient(id="p2", display="B", birth_year=1980, doctor_id="d2"))
    store.append_response(response("p1", AT.replace(minute=1)))
    store.append_response(response("p1", AT.replace(minute=5)))

    bundles = store.doctor_patients("d1")
    assert [b.patient.id for b in bundles] == ["p1"]
    assert bundles[0].latest_response is not None
    assert bundles[0].latest_response.submitted_at.minute == 5


def test_patient_state_is_none_for_an_unknown_patient(store):
    assert store.patient_state("nobody") is None


def test_idempotency_round_trips(store):
    assert store.idem_get("k") is None
    store.idem_put("k", ("fingerprint", 42))
    assert store.idem_get("k") == ("fingerprint", 42)


def test_saving_an_alert_replaces_by_key_rather_than_appending(store):
    key = SignalKey("p1", "suicide_risk_item", "instrument", "")
    for state in (AlertState.SEEN, AlertState.RESOLVED):
        store.save_alert(Alert(key=key, state=state, at=AT, actor_id="d1"))
    state = store.patient_state("p1")
    assert state is None  # no patient row yet
    store.add_patient(Patient(id="p1", display="A", birth_year=1980, doctor_id="d1"))
    assert [a.state for a in store.patient_state("p1").alerts] == [AlertState.RESOLVED]


def test_messages_and_assignments_are_scoped_by_patient(store):
    store.append_message(Message(id="m1", patient_id="p1", author_id="p1",
                                 direction="to_doctor", text="hi", at=AT))
    store.add_assignment(Assignment(id="a1", patient_id="p1",
                                    instrument_code="PHQ9-RU", created_at=AT))
    store.add_patient(Patient(id="p1", display="A", birth_year=1980, doctor_id="d1"))
    state = store.patient_state("p1")
    assert len(state.messages) == 1
    assert store.assignment("a1").patient_id == "p1"
