"""Invariants at the Clinical seam.

These tests cross the same interface the HTTP layer will: they assert on
behaviour, not on internal state, so a refactor inside the module keeps them
meaningful.
"""

from __future__ import annotations

import dataclasses
from datetime import datetime, timezone

import pytest

from apps.api.clinic import (
    Actor, AppointmentDraft, Assessment, Card, Clinical, ErrorKind, Feed,
    MemoryStore, Obligation, Patient, Plan, Prescription, Referral, Rejected,
    Role, SignalKey,
)
from compass.ai.triage import Candidate, Rank, Severity
from compass.instruments import load_strict

FIXED = datetime(2026, 10, 20, 9, 0, tzinfo=timezone.utc)
ITEMS = {f"q{i}": 0 for i in range(1, 10)}


class FakeCatalog:
    known = {"AVIANDR": ("20 мг",), "SERTRALINE": ("50 мг",)}

    def validate(self, drug_code, dose):
        if drug_code not in self.known:
            raise Rejected(ErrorKind.UNKNOWN_DRUG, drug_code)
        if dose not in self.known[drug_code]:
            raise Rejected(ErrorKind.DOSE_NOT_IN_LABEL, dose)


def make(*, screener=None):
    store = MemoryStore()
    counter = iter(range(1, 10_000))
    clinical = Clinical(
        store, load_strict(), FakeCatalog(),
        screener=screener,
        clock=lambda: FIXED,
        new_id=lambda: f"id{next(counter)}",
    )
    return clinical, store


def add_patient(store, pid, doctor_id="d1", birth_year=1975, display="Тестова А. А."):
    store.add_patient(Patient(id=pid, display=display, birth_year=birth_year,
                              doctor_id=doctor_id))


def add_assignment(store, aid, pid, code="PHQ9-RU"):
    from apps.api.clinic import Assignment
    store.add_assignment(Assignment(id=aid, patient_id=pid, instrument_code=code, created_at=FIXED))


doctor = Actor("d1", Role.DOCTOR)


# --------------------------------------------------------------- the gate

def test_a_clinical_write_without_a_signature_is_refused_and_writes_nothing():
    clinical, store = make()
    add_patient(store, "p1")
    with pytest.raises(Rejected) as err:
        clinical.commit_appointment(
            doctor, AppointmentDraft(patient_id="p1", signature="   "), submission_key="k1"
        )
    assert err.value.kind is ErrorKind.UNSIGNED
    assert store.appointments == {}
    assert store.audit == []


def test_a_critical_finding_must_be_reviewed_before_the_appointment_is_signed():
    clinical, store = make()
    add_patient(store, "p1")
    add_assignment(store, "a1", "p1")
    answers = dict(ITEMS, q9=2)
    clinical.submit_response(Actor("p1", Role.PATIENT), "a1", answers, submission_key="s1")

    key = SignalKey("p1", "suicide_risk_item", "instrument", "")
    with pytest.raises(Rejected) as err:
        clinical.commit_appointment(
            doctor, AppointmentDraft(patient_id="p1", signature="Тестова"), submission_key="k1"
        )
    assert err.value.kind is ErrorKind.NEEDS_ACKNOWLEDGEMENT

    signed = clinical.commit_appointment(
        doctor, AppointmentDraft(patient_id="p1", signature="Тестова",
                                 acknowledged=(key,)), submission_key="k1"
    )
    assert signed.signature == "Тестова"


def test_an_obligatory_referral_cannot_be_downgraded_silently():
    clinical, store = make()
    add_patient(store, "p1")
    add_assignment(store, "a1", "p1")
    clinical.submit_response(Actor("p1", Role.PATIENT), "a1", dict(ITEMS, q9=1),
                             submission_key="s1")
    key = SignalKey("p1", "suicide_risk_item", "instrument", "")
    with pytest.raises(Rejected) as err:
        clinical.commit_appointment(
            doctor,
            AppointmentDraft(patient_id="p1", signature="Тестова", acknowledged=(key,),
                             referral=Referral("psychiatrist", Obligation.DESIRABLE)),
            submission_key="k1",
        )
    assert err.value.kind is ErrorKind.OBLIGATION_DOWNGRADED


# ------------------------------------------------------- ordering law

def test_a_suspected_critical_outranks_a_verified_moderate_score():
    """Severity is the first axis, provenance only breaks ties."""
    def suicide_screen(text):
        return (Candidate("suicide_risk", "decision_model", Rank.URGENT, False,
                          "модель: «нет смысла продолжать»", 74),)

    clinical, store = make(screener=suicide_screen)
    add_patient(store, "p1", display="Пирогова А. М.")
    add_patient(store, "p2", display="Ковалёв Д. С.")
    add_assignment(store, "a1", "p1")
    clinical.submit_response(Actor("p1", Role.PATIENT), "a1",
                             dict(ITEMS, **{f"q{i}": 3 for i in (1, 2, 3, 4, 5)}),
                             submission_key="s1")
    clinical.send_message(Actor("p2", Role.PATIENT), "p2", "нет смысла продолжать",
                          submission_key="m1")

    queue = clinical.queue(doctor)
    assert [r.key.patient_id for r in queue.attention] == ["p2", "p1"]
    assert queue.attention[0].severity is Severity.CRITICAL
    assert queue.attention[0].authoritative is False
    assert queue.attention[1].authoritative is True


def test_a_verified_critical_leads_a_suspected_one():
    def suicide_screen(text):
        return (Candidate("suicide_risk", "decision_model", Rank.URGENT, False, "модель", 74),)

    clinical, store = make(screener=suicide_screen)
    add_patient(store, "p1")
    add_patient(store, "p2")
    add_assignment(store, "a1", "p1")
    clinical.submit_response(Actor("p1", Role.PATIENT), "a1", dict(ITEMS, q9=2),
                             submission_key="s1")
    clinical.send_message(Actor("p2", Role.PATIENT), "p2", "нет смысла продолжать",
                          submission_key="m1")

    queue = clinical.queue(doctor)
    assert [r.key.patient_id for r in queue.attention] == ["p1", "p2"]
    assert queue.revision == clinical.queue(doctor).revision
    assert clinical.queue(doctor, since_revision=queue.revision).stable is True


def test_the_queue_is_a_snapshot_with_a_stable_revision():
    clinical, store = make()
    add_patient(store, "p1")
    add_assignment(store, "a1", "p1")
    clinical.submit_response(Actor("p1", Role.PATIENT), "a1", dict(ITEMS, q1=1),
                             submission_key="s1")
    first = clinical.queue(doctor)
    add_patient(store, "p2", display="Никитин Р. Э.")
    second = clinical.queue(doctor, since_revision=first.revision)
    assert second.stable is False
    assert second.revision != first.revision


# ------------------------------------------------------------ the model

def test_screening_runs_once_at_write_and_is_not_recomputed_on_read():
    calls = []

    def counting_screen(text):
        calls.append(text)
        return (Candidate("worsening", "decision_model", Rank.SOON, False, "модель", 61),)

    clinical, store = make(screener=counting_screen)
    add_patient(store, "p1")
    clinical.send_message(Actor("p1", Role.PATIENT), "p1", "стало хуже, чем было",
                          submission_key="m1")
    clinical.queue(doctor)
    clinical.queue(doctor)
    clinical.card(doctor, "p1")
    assert len(calls) == 1


def test_advice_degrades_instead_of_failing_when_there_is_no_model():
    clinical, store = make()
    add_patient(store, "p1")
    advice = clinical.advise(doctor, "p1", "Есть ли противопоказания?")
    assert advice.degraded is True
    assert advice.answer is None
    assert advice.reason


# ------------------------------------------------------------- the feed

def test_nothing_reaches_the_patient_until_the_doctor_publishes_it():
    clinical, store = make()
    add_patient(store, "p1")
    appointment = clinical.commit_appointment(
        doctor,
        AppointmentDraft(patient_id="p1", signature="Тестова",
                         plan=Plan(notes="Продолжаем Авиандр")),
        submission_key="k1",
    )
    patient = Actor("p1", Role.PATIENT)
    assert [c.kind for c in clinical.feed(patient).cards] == []

    clinical.publish(doctor, appointment.id, ["plan"])
    cards = clinical.feed(patient).cards
    assert [c.kind for c in cards] == ["published"]
    assert "Авиандр" in cards[0].body


def test_patient_facing_types_have_no_field_able_to_hold_a_score():
    for cls in (Card, Feed, Assessment):
        names = {f.name for f in dataclasses.fields(cls)}
        assert not names & {"total", "band", "band_label", "severity", "score", "signals"}


# ---------------------------------------------------------- entitlement

def test_a_doctor_cannot_read_a_patient_they_are_not_linked_to():
    clinical, store = make()
    add_patient(store, "p1", doctor_id="d2")
    with pytest.raises(Rejected) as err:
        clinical.card(doctor, "p1")
    assert err.value.kind is ErrorKind.NOT_YOUR_PATIENT


def test_a_patient_cannot_read_the_queue_or_another_patients_record():
    clinical, store = make()
    add_patient(store, "p1")
    add_patient(store, "p2")
    with pytest.raises(Rejected) as err:
        clinical.queue(Actor("p1", Role.PATIENT))
    assert err.value.kind is ErrorKind.ROLE
    with pytest.raises(Rejected) as err:
        clinical.card(Actor("p2", Role.PATIENT), "p1")
    assert err.value.kind is ErrorKind.NOT_YOUR_PATIENT


# --------------------------------------------------------- idempotency

def test_the_same_submission_key_returns_the_same_appointment():
    clinical, store = make()
    add_patient(store, "p1")
    draft = AppointmentDraft(patient_id="p1", signature="Тестова")
    first = clinical.commit_appointment(doctor, draft, submission_key="k1")
    second = clinical.commit_appointment(doctor, draft, submission_key="k1")
    assert first.id == second.id
    assert len(store.appointments) == 1


def test_a_reused_key_with_different_content_is_a_conflict():
    clinical, store = make()
    add_patient(store, "p1")
    clinical.commit_appointment(
        doctor, AppointmentDraft(patient_id="p1", signature="Тестова"), submission_key="k1"
    )
    with pytest.raises(Rejected) as err:
        clinical.commit_appointment(
            doctor,
            AppointmentDraft(patient_id="p1", signature="Тестова", complaint="другое"),
            submission_key="k1",
        )
    assert err.value.kind is ErrorKind.CONFLICT


def test_answers_must_name_every_item_and_submission_is_idempotent():
    clinical, store = make()
    add_patient(store, "p1")
    add_assignment(store, "a1", "p1")
    patient = Actor("p1", Role.PATIENT)

    with pytest.raises(Rejected) as err:
        clinical.submit_response(patient, "a1", {"q1": 0}, submission_key="s1")
    assert err.value.kind is ErrorKind.INCOMPLETE

    first = clinical.submit_response(patient, "a1", dict(ITEMS), submission_key="s1")
    second = clinical.submit_response(patient, "a1", dict(ITEMS), submission_key="s1")
    assert first.response_id == second.response_id
    assert len(store.responses) == 1
