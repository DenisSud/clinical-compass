"""The web adapter: two clients, one module.

These tests go through HTTP on purpose. They check that the routes stay thin —
that no screen invents an ordering, a severity, or a permission of its own — and
that the patient's side cannot show a number it is not supposed to show (D5).
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from apps.api.clinic import Assignment, Patient, Response, SqliteStore, Visit
from apps.web import auth
from apps.web.app import create_app
from compass.instruments import load_strict

NOW = datetime.now(timezone.utc).replace(second=0, microsecond=0)
REGISTRY = load_strict()
DOCTOR = "d1"


def phq9(total: int) -> dict:
    answers = {f"q{i}": 0 for i in range(1, 10)}
    left = total
    for key in ("q1", "q2", "q3", "q4", "q5", "q6", "q7", "q8"):
        take = max(0, min(3, left))
        answers[key] = take
        left -= take
    return answers


def build(path: Path) -> TestClient:
    store = SqliteStore(str(path))
    store.add_patient(Patient(id="p1", display="Тестова Анна", birth_year=1990,
                              doctor_id=DOCTOR, linked_since=NOW - timedelta(days=30)))
    store.add_patient(Patient(id="p2", display="Второва Мария", birth_year=1980,
                              doctor_id=DOCTOR, linked_since=NOW - timedelta(days=30)))
    store.add_assignment(Assignment(id="a1", patient_id="p1", instrument_code="PHQ9-RU",
                                    created_at=NOW - timedelta(days=7),
                                    due_on=(NOW - timedelta(days=7)).date()))
    store.append_response(Response(
        id="r1", assignment_id="a1", patient_id="p1", instrument_code="PHQ9-RU",
        definition_sha256=REGISTRY.get("PHQ9-RU").sha256,
        answers=phq9(18), submitted_at=NOW - timedelta(days=7),
    ))
    store.append_visit(Visit(id="v1", patient_id="p1", doctor_id=DOCTOR,
                             scheduled_at=NOW + timedelta(days=3)))

    db = auth.open_db(path)
    db.execute("INSERT INTO users VALUES (?,?,?,?,?,?,?)",
               (DOCTOR, "doctor@clinic.ru", auth.hash_password("compass"),
                "doctor", "Врач", None, None))
    db.execute("INSERT INTO users VALUES (?,?,?,?,?,?,?)",
               ("u-p1", None, "!", "patient", "Тестова Анна", "p1", "tok-p1"))
    db.execute("INSERT INTO users VALUES (?,?,?,?,?,?,?)",
               ("u-p2", None, "!", "patient", "Второва Мария", "p2", "tok-p2"))
    return TestClient(create_app(path))


@pytest.fixture
def client(tmp_path):
    with build(tmp_path / "app.db") as test_client:
        yield test_client


def as_doctor(client) -> TestClient:
    response = client.post("/login", data={"email": "doctor@clinic.ru",
                                           "password": "compass"},
                           follow_redirects=False)
    assert response.status_code == 303
    return client


def as_patient(client, token: str = "tok-p1") -> TestClient:
    response = client.get(f"/enter/{token}", follow_redirects=False)
    assert response.status_code == 303
    return client


# ------------------------------------------------------------- entitlement

def test_an_anonymous_visitor_lands_on_the_login_page(client):
    response = client.get("/panel", follow_redirects=False)
    assert response.status_code == 303
    assert response.headers["location"] == "/login"


def test_a_wrong_password_is_refused(client):
    response = client.post("/login", data={"email": "doctor@clinic.ru",
                                           "password": "nope"})
    assert response.status_code == 200
    assert "Неверная почта или пароль" in response.text


def test_a_patient_cannot_open_the_doctor_panel(client):
    as_patient(client)
    response = client.get("/panel", follow_redirects=False)
    assert response.status_code == 303
    assert response.headers["location"] == "/today"


def test_a_doctor_cannot_open_a_patient_screen(client):
    as_doctor(client)
    response = client.get("/today", follow_redirects=False)
    assert response.status_code == 303
    assert response.headers["location"] == "/panel"


def test_logout_ends_the_session(client):
    as_doctor(client)
    assert client.get("/panel").status_code == 200
    client.post("/logout", follow_redirects=False)
    assert client.get("/panel", follow_redirects=False).status_code == 303


# ------------------------------------------------------------ what is shown

def test_the_doctor_panel_shows_the_scored_answer(client):
    as_doctor(client)
    page = client.get("/panel").text
    assert "Тестова Анна" in page
    assert ">18<" in page and "из 27" in page


def test_the_patient_screen_never_shows_a_score_band_or_severity(client):
    """D5. The patient sees the fact of their own submission and nothing else."""
    as_patient(client)
    today = client.get("/today").text
    history = client.get("/my").text
    for forbidden in ("из 27", "Умеренно", "PHQ-9:", "балл"):
        assert forbidden not in today
        assert forbidden not in history
    assert "PHQ-9" in history or "Дневник" in history  # the fact, not the number


def test_the_patient_sees_their_next_visit(client):
    as_patient(client)
    expected = (NOW + timedelta(days=3)).strftime("%d.%m.%Y")
    assert "Тестова Анна" in client.get("/today").text
    assert expected in client.get("/today").text


# ------------------------------------------------------------- submission

def test_a_patient_submits_a_questionnaire_and_the_doctor_sees_it(client):
    as_patient(client)
    today = client.get("/today").text
    assert "Ежедневная отметка самочувствия" in today
    # the weekly PHQ-9 is due too, so the link must be read from the right card
    match = re.search(r"Ежедневная отметка самочувствия.*?/tests/([0-9a-f]+)", today, re.S)
    assert match, "the daily check has no form link"
    assignment = match.group(1)

    response = client.post(
        f"/tests/{assignment}",
        data={"q_mood": "2", "q_sleep": "1", "q_anxiety": "2", "q_energy": "3",
              "q_harm": "0"},
        follow_redirects=False,
    )
    assert response.status_code == 303
    assert response.headers["location"] == "/today?saved=1"
    assert "Ответ отправлен" in client.get("/today?saved=1").text

    as_doctor(client)
    assert "Тестова Анна" in client.get("/panel/p1").text


def test_an_incomplete_form_is_refused_without_writing(client):
    as_patient(client)
    today = client.get("/today").text
    match = re.search(r"Ежедневная отметка самочувствия.*?/tests/([0-9a-f]+)", today, re.S)
    assert match
    response = client.post(f"/tests/{match.group(1)}", data={"q_mood": "2"})
    assert response.status_code == 200
    assert "без ответа" in response.text


def test_a_patient_cannot_submit_another_patients_assignment(client):
    as_patient(client, "tok-p2")
    response = client.post(
        "/tests/a1",
        data={"q1": "0", "q2": "0", "q3": "0", "q4": "0", "q5": "0", "q6": "0",
              "q7": "0", "q8": "0", "q9": "0"},
        follow_redirects=False,
    )
    # not theirs to fill, so the form is not offered — and now the page says so
    # instead of dropping the submission on a bare redirect
    assert response.status_code == 200
    assert "недоступна" in response.text

    as_doctor(client)
    # nothing was written for p2: their dashboard still has no answers at all
    card = client.get("/panel/p2").text
    assert "Второва Мария" in card
    assert "Ответов пока нет." in card


def test_the_doctor_sees_visits_and_can_read_one_patient(client):
    as_doctor(client)
    assert "Тестова Анна" in client.get("/visits").text
    assert "Что видно по данным" in client.get("/panel/p1").text


# --------------------------------- errors the patient can cause must not be fatal

def test_a_value_off_the_scale_is_refused_and_nothing_is_stored(client):
    """One out-of-range point used to poison every later read of that patient.

    The write path checked which items arrived, not what values they carried, so
    `q_harm=99` was stored, and then every doctor screen for that patient raised
    inside scoring — permanently, because responses are append-only.
    """
    as_patient(client)
    page = client.get("/today").text
    match = re.search(r"Ежедневная отметка самочувствия.*?/tests/([0-9a-f]+)", page, re.S)
    assert match

    response = client.post(
        f"/tests/{match.group(1)}",
        data={"q_mood": "1", "q_sleep": "1", "q_anxiety": "1", "q_energy": "1",
              "q_harm": "99"},
    )
    assert response.status_code == 200
    assert "не сохранён" in response.text or "Ответ не" in response.text or "99" in response.text

    as_doctor(client)
    assert client.get("/panel").status_code == 200
    assert client.get("/panel/p1").status_code == 200


def test_a_visit_can_be_scheduled_from_the_form(client):
    """The form posted a datetime-local value and the naive/aware comparison
    raised TypeError, so the only scheduling path returned 500 every time."""
    as_doctor(client)
    when = (NOW + timedelta(days=9)).strftime("%Y-%m-%dT%H:%M")
    response = client.post(f"/panel/p1/visits", data={"when": when,
                                                     "kind": "контрольный"},
                           follow_redirects=False)
    assert response.status_code == 303
    assert "error=" not in response.headers["location"]
    page = client.get("/panel/p1").text
    assert (NOW + timedelta(days=9)).strftime("%d.%m.%Y") in page


def test_a_visit_in_the_past_is_refused_with_a_reason(client):
    as_doctor(client)
    when = (NOW - timedelta(days=2)).strftime("%Y-%m-%dT%H:%M")
    response = client.post("/panel/p1/visits", data={"when": when},
                           follow_redirects=False)
    assert response.status_code == 303
    assert "error=" in response.headers["location"]
    assert "прошлое" in client.get(response.headers["location"]).text
