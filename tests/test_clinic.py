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
    Actor, AlertState, AppointmentDraft, Assessment, Card, Clinical, ErrorKind,
    Feed, MemoryStore, Obligation, Patient, Plan, Prescription, Referral, Rejected,
    Role, SignalKey, SqliteStore,
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


@pytest.fixture(params=["memory", "sqlite"])
def app(request):
    """Every behaviour test runs twice: once against dicts, once against SQL.

    The point is not coverage — it is that a divergence between the adapters
    becomes a failing test rather than a bug found in the demo.
    """
    def build(*, screener=None, path=":memory:"):
        store = MemoryStore() if request.param == "memory" else SqliteStore(path)
        counter = iter(range(1, 10_000))
        clinical = Clinical(
            store, load_strict(), FakeCatalog(),
            screener=screener,
            clock=lambda: FIXED,
            new_id=lambda: f"id{next(counter)}",
        )
        return clinical, store
    return build


def add_patient(store, pid, doctor_id="d1", birth_year=1975, display="Тестова А. А."):
    store.add_patient(Patient(id=pid, display=display, birth_year=birth_year,
                              doctor_id=doctor_id))


def add_assignment(store, aid, pid, code="PHQ9-RU"):
    from apps.api.clinic import Assignment
    store.add_assignment(Assignment(id=aid, patient_id=pid, instrument_code=code, created_at=FIXED))


doctor = Actor("d1", Role.DOCTOR)


# --------------------------------------------------------------- the gate

def test_a_clinical_write_without_a_signature_is_refused_and_writes_nothing(app):
    clinical, store = app()
    add_patient(store, "p1")
    with pytest.raises(Rejected) as err:
        clinical.commit_appointment(
            doctor, AppointmentDraft(patient_id="p1", signature="   "), submission_key="k1"
        )
    assert err.value.kind is ErrorKind.UNSIGNED
    assert store.patient_state("p1").appointments == ()
    assert store.audit_of("p1") == ()


def test_a_critical_finding_must_be_reviewed_before_the_appointment_is_signed(app):
    clinical, store = app()
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


def test_an_obligatory_referral_cannot_be_downgraded_silently(app):
    clinical, store = app()
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

def test_a_suspected_critical_outranks_a_verified_moderate_score(app):
    """Severity is the first axis, provenance only breaks ties."""
    def suicide_screen(text):
        return (Candidate("suicide_risk", "decision_model", Rank.URGENT, False,
                          "модель: «нет смысла продолжать»", 74),)

    clinical, store = app(screener=suicide_screen)
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


def test_a_verified_critical_leads_a_suspected_one(app):
    def suicide_screen(text):
        return (Candidate("suicide_risk", "decision_model", Rank.URGENT, False, "модель", 74),)

    clinical, store = app(screener=suicide_screen)
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


def test_the_queue_is_a_snapshot_with_a_stable_revision(app):
    clinical, store = app()
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

def test_screening_runs_once_at_write_and_is_not_recomputed_on_read(app):
    calls = []

    def counting_screen(text):
        calls.append(text)
        return (Candidate("worsening", "decision_model", Rank.SOON, False, "модель", 61),)

    clinical, store = app(screener=counting_screen)
    add_patient(store, "p1")
    clinical.send_message(Actor("p1", Role.PATIENT), "p1", "стало хуже, чем было",
                          submission_key="m1")
    clinical.queue(doctor)
    clinical.queue(doctor)
    clinical.card(doctor, "p1")
    assert len(calls) == 1


def test_advice_degrades_instead_of_failing_when_there_is_no_model(app):
    clinical, store = app()
    add_patient(store, "p1")
    advice = clinical.advise(doctor, "p1", "Есть ли противопоказания?")
    assert advice.degraded is True
    assert advice.answer is None
    assert advice.reason


# ------------------------------------------------------------- the feed

def test_nothing_reaches_the_patient_until_the_doctor_publishes_it(app):
    clinical, store = app()
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


def test_patient_facing_types_have_no_field_able_to_hold_a_score(app):
    for cls in (Card, Feed, Assessment):
        names = {f.name for f in dataclasses.fields(cls)}
        assert not names & {"total", "band", "band_label", "severity", "score", "signals"}


# ---------------------------------------------------------- entitlement

def test_a_doctor_cannot_read_a_patient_they_are_not_linked_to(app):
    clinical, store = app()
    add_patient(store, "p1", doctor_id="d2")
    with pytest.raises(Rejected) as err:
        clinical.card(doctor, "p1")
    assert err.value.kind is ErrorKind.NOT_YOUR_PATIENT


def test_a_patient_cannot_read_the_queue_or_another_patients_record(app):
    clinical, store = app()
    add_patient(store, "p1")
    add_patient(store, "p2")
    with pytest.raises(Rejected) as err:
        clinical.queue(Actor("p1", Role.PATIENT))
    assert err.value.kind is ErrorKind.ROLE
    with pytest.raises(Rejected) as err:
        clinical.card(Actor("p2", Role.PATIENT), "p1")
    assert err.value.kind is ErrorKind.NOT_YOUR_PATIENT


# --------------------------------------------------------- idempotency

def test_the_same_submission_key_returns_the_same_appointment(app):
    clinical, store = app()
    add_patient(store, "p1")
    draft = AppointmentDraft(patient_id="p1", signature="Тестова")
    first = clinical.commit_appointment(doctor, draft, submission_key="k1")
    second = clinical.commit_appointment(doctor, draft, submission_key="k1")
    assert first.id == second.id
    assert len(store.patient_state("p1").appointments) == 1


def test_a_reused_key_with_different_content_is_a_conflict(app):
    clinical, store = app()
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


def test_answers_must_name_every_item_and_submission_is_idempotent(app):
    clinical, store = app()
    add_patient(store, "p1")
    add_assignment(store, "a1", "p1")
    patient = Actor("p1", Role.PATIENT)

    with pytest.raises(Rejected) as err:
        clinical.submit_response(patient, "a1", {"q1": 0}, submission_key="s1")
    assert err.value.kind is ErrorKind.INCOMPLETE

    first = clinical.submit_response(patient, "a1", dict(ITEMS), submission_key="s1")
    second = clinical.submit_response(patient, "a1", dict(ITEMS), submission_key="s1")
    assert first.response_id == second.response_id
    assert len(store.patient_state("p1").responses) == 1


# ------------------------------------------------- safety is an event, not state

def test_a_safety_signal_is_not_hidden_by_a_later_answer(app):
    """A band describes now; a reported thought describes an event.

    The first version read only the newest response, so today's self-harm tick
    disappeared behind the same day's questionnaire. This test is that bug.
    """
    from datetime import timedelta

    from apps.api.clinic import Assignment, Response
    from compass.instruments import load_strict

    clinical, store = app()
    add_patient(store, "p1")
    add_assignment(store, "a1", "p1")
    clinical.submit_response(Actor("p1", Role.PATIENT), "a1", dict(ITEMS, q9=2),
                             submission_key="s1")

    daily = load_strict().get("WELLBEING-DAILY")
    store.add_assignment(Assignment(id="a2", patient_id="p1",
                                    instrument_code="WELLBEING-DAILY",
                                    created_at=FIXED, due_on=FIXED.date()))
    store.append_response(Response(
        id="r2", assignment_id="a2", patient_id="p1",
        instrument_code="WELLBEING-DAILY", definition_sha256=daily.sha256,
        answers={"mood": 0, "sleep": 0, "anxiety": 0, "energy": 0, "harm": 0},
        submitted_at=FIXED + timedelta(hours=5),
    ))

    board = clinical.dashboard(doctor, "p1")
    assert any(s.signal == "suicide_risk_item" for s in board.signals)


def test_a_totals_signal_does_not_accumulate_from_history(app):
    """Two severe answers are one current state, not two rows."""
    from datetime import timedelta

    from apps.api.clinic import Assignment, Response
    from compass.instruments import load_strict

    clinical, store = app()
    add_patient(store, "p1")
    instrument = load_strict().get("PHQ9-RU")
    for index, when in enumerate((FIXED - timedelta(days=7), FIXED)):
        store.add_assignment(Assignment(id=f"a{index}", patient_id="p1",
                                        instrument_code="PHQ9-RU",
                                        created_at=when, due_on=when.date()))
        store.append_response(Response(
            id=f"r{index}", assignment_id=f"a{index}", patient_id="p1",
            instrument_code="PHQ9-RU", definition_sha256=instrument.sha256,
            answers=dict(ITEMS, **{f"q{i}": 3 for i in range(1, 9)}),
            submitted_at=when,
        ))

    # read through the card, which keeps every candidate; the dashboard filters
    # the score out on purpose, because it is already printed as a number
    case = clinical.card(doctor, "p1")
    assert sum(1 for s in case.signals if s.key.signal == "severe_score") == 1


# ------------------------------------------------- an alert needs evidence

def test_acknowledging_a_signal_that_was_never_raised_is_refused(app):
    """An audit trail saying "a critical finding was resolved" is worse than an
    empty one when no such finding ever existed."""
    clinical, store = app()
    add_patient(store, "p1")
    with pytest.raises(Rejected) as err:
        clinical.acknowledge(
            doctor, SignalKey("p1", "suicide_risk_item", "instrument", ""),
            AlertState.RESOLVED,
        )
    assert err.value.kind is ErrorKind.NOT_FOUND
    assert store.patient_state("p1").alerts == ()


def test_an_appointment_cannot_acknowledge_a_finding_that_does_not_exist(app):
    clinical, store = app()
    add_patient(store, "p1")
    with pytest.raises(Rejected) as err:
        clinical.commit_appointment(
            doctor,
            AppointmentDraft(patient_id="p1", signature="Тестова",
                             acknowledged=(SignalKey("p1", "suicide_risk_item",
                                                     "instrument", ""),)),
            submission_key="k1",
        )
    assert err.value.kind is ErrorKind.NOT_FOUND
