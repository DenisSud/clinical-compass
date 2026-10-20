"""Demo data: six patients, two weeks of answers, a few visits.

This writes responses directly rather than through `Clinical.submit_response`,
because the gate stamps `now` and a fabricated history needs its own timestamps.
That is the only reason, and it is deliberate: the seed is not a client.
"""

from __future__ import annotations

import argparse
import secrets
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

# Runnable straight from a shell, not only as a module.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from apps.api.clinic import Assignment, Patient, Response, SqliteStore, Visit
from apps.web import auth
from compass.instruments import load_strict

REGISTRY = load_strict()
NOW = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)

DOCTOR_ID = "d1"
DOCTOR_EMAIL = "doctor@clinic.ru"
DOCTOR_PASSWORD = "compass"

#: (id, имя, год рождения, баллы PHQ-9 по неделям, доля заполненных дней,
#:  возраст последнего ответа в днях, заметка)
PEOPLE = [
    ("p1", "Пирогова Анна Максимовна", 1991, [18, 12, 9], 0.9, 0, "снижение за три недели"),
    ("p2", "Ковалёв Дмитрий Сергеевич", 1985, [8, 13, 18], 0.8, 0, "рост за три недели"),
    ("p3", "Соколова Мария Ильинична", 1998, [7, 6, 7], 1.0, 2, "стабильно, легко"),
    ("p4", "Гусев Пётр Артёмович", 1972, [22], 0.0, 30, "давно не выходит на связь"),
    ("p5", "Лебедева Ольга Викторовна", 1994, [15, 16], 0.3, 5, "заполняет через раз"),
    ("p6", "Никитин Роман Эдуардович", 2000, [11, 15], 0.7, 0, "сегодня отметил мысли о вреде себе"),
]


def phq9_answers(total: int, *, self_harm: int = 0) -> dict:
    answers = {f"q{i}": 0 for i in range(1, 10)}
    answers["q9"] = self_harm
    left = total - self_harm
    for key in ("q1", "q2", "q3", "q4", "q5", "q6", "q7", "q8"):
        take = max(0, min(3, left))
        answers[key] = take
        left -= take
    return answers


def daily_answers(mood: int, *, harm: int = 0) -> dict:
    mood = max(0, min(3, mood))
    return {"mood": mood, "sleep": max(0, min(3, mood)), "anxiety": max(0, min(3, mood)),
            "energy": max(0, min(3, mood)), "harm": harm}


def seed(db_path: Path, *, reset: bool = False) -> list[tuple[str, str]]:
    if reset and db_path.exists():
        db_path.unlink()
    db_path.parent.mkdir(parents=True, exist_ok=True)

    store = SqliteStore(str(db_path))
    logins: list[tuple[str, str]] = []

    for index, (pid, display, birth_year, totals, adherence, last_age, _note) in enumerate(PEOPLE):
        store.add_patient(
            Patient(
                id=pid, display=display, birth_year=birth_year, doctor_id=DOCTOR_ID,
                linked_since=NOW - timedelta(days=60 + index),
                profile={"note": _note},
            )
        )
        access = auth.open_db(db_path)
        token = f"{pid}-{secrets.token_urlsafe(8)}"
        access.execute(
            "INSERT OR REPLACE INTO users VALUES (?,?,?,?,?,?,?)",
            (f"u-{pid}", None, "!", "patient", display, pid, token),
        )
        access.close()
        logins.append((display, f"http://127.0.0.1:8030/enter/{token}"))

        # weekly PHQ-9, oldest first, seven days apart
        for step, total in enumerate(reversed(totals)):
            days_ago = step * 7 + last_age
            when = NOW - timedelta(days=days_ago)
            assignment = Assignment(
                id=f"a-{pid}-phq9-{days_ago}", patient_id=pid,
                instrument_code="PHQ9-RU", created_at=when, due_on=when.date(),
            )
            store.append_assignment(assignment)
            store.append_response(
                Response(
                    id=f"r-{pid}-phq9-{days_ago}", assignment_id=assignment.id,
                    patient_id=pid, instrument_code="PHQ9-RU",
                    definition_sha256=REGISTRY.get("PHQ9-RU").sha256,
                    answers=phq9_answers(
                        total,
                        self_harm=(1 if pid == "p6" and days_ago == last_age else 0),
                    ),
                    submitted_at=when,
                )
            )

        # daily ticks for the last fourteen days, thinned by adherence
        latest_total = totals[-1]
        for days_ago in range(last_age, 14 + last_age):
            if adherence < 1.0 and (days_ago * 7) % 10 < int((1.0 - adherence) * 10):
                continue
            if adherence == 0.0:
                continue
            when = NOW - timedelta(days=days_ago)
            # Symptom points are 0..3 and higher is worse, so a worsening patient
            # must rise towards today, not away from it.
            trend = 1 if latest_total >= 12 else -1
            drift = trend * (7 - days_ago) / 7
            mood = round(max(0, min(3, latest_total / 9 + drift)))
            assignment = Assignment(
                id=f"a-{pid}-daily-{days_ago}", patient_id=pid,
                instrument_code="WELLBEING-DAILY", created_at=when, due_on=when.date(),
            )
            store.append_assignment(assignment)
            store.append_response(
                Response(
                    id=f"r-{pid}-daily-{days_ago}", assignment_id=assignment.id,
                    patient_id=pid, instrument_code="WELLBEING-DAILY",
                    definition_sha256=REGISTRY.get("WELLBEING-DAILY").sha256,
                    answers=daily_answers(
                        mood, harm=(1 if pid == "p6" and days_ago == last_age else 0),
                    ),
                    submitted_at=when,
                )
            )

    visits = [
        ("v1", "p1", 3, "консультация"),
        ("v2", "p2", 1, "консультация"),
        ("v3", "p6", 1, "консультация"),
        ("v4", "p5", 6, "консультация"),
        ("v5", "p3", 12, "контрольный"),
        ("v6", "p4", 8, "консультация"),
    ]
    for vid, pid, days, kind in visits:
        store.append_visit(
            Visit(
                id=vid, patient_id=pid, doctor_id=DOCTOR_ID,
                scheduled_at=(NOW + timedelta(days=days)).replace(hour=10),
                kind=kind,
            )
        )

    access = auth.open_db(db_path)
    access.execute(
        "INSERT OR REPLACE INTO users VALUES (?,?,?,?,?,?,?)",
        (DOCTOR_ID, DOCTOR_EMAIL, auth.hash_password(DOCTOR_PASSWORD), "doctor",
         "Петрова Ирина Львовна", None, None),
    )
    access.close()
    return logins


def main() -> None:
    parser = argparse.ArgumentParser(description="Демонстрационные данные")
    parser.add_argument("--db", default="var/compass.db")
    parser.add_argument("--reset", action="store_true")
    args = parser.parse_args()

    logins = seed(Path(args.db), reset=args.reset)
    print(f"врач: {DOCTOR_EMAIL} / {DOCTOR_PASSWORD}")
    for display, link in logins:
        print(f"пациент: {display}\n  {link}")


if __name__ == "__main__":
    main()
