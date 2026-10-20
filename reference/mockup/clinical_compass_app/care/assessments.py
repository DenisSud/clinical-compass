"""Versioned PHQ-9 self-report for synthetic demo only; no diagnosis/treatment rules."""
import hashlib
import json
from collections import Counter
from datetime import timedelta
from pathlib import Path
from django.conf import settings
from django.core import signing
from django.core.exceptions import PermissionDenied, ValidationError
from django.db import IntegrityError, transaction
from django.utils import timezone
from .models import Assessment, AssessmentAttention, AssessmentReview, User
from .services import _patient_relation, audit, require_role

DEFINITION = json.loads((Path(__file__).parent / "instruments" / "phq9_ru.json").read_text(encoding="utf-8"))
DEFINITION_HASH = hashlib.sha256(json.dumps(DEFINITION, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
KEYS = [item["key"] for item in DEFINITION["items"]]


def require_demo():
    if not settings.DEMO_MODE:
        raise PermissionDenied("Модуль шкал пока доступен только в синтетическом демо.")


def form_token():
    return signing.dumps({"definition": DEFINITION_HASH}, salt="assessment-form")


def validate_token(token):
    try:
        payload = signing.loads(token, salt="assessment-form", max_age=10800)
    except signing.BadSignature as exc:
        raise ValidationError("Форма устарела. Откройте опросник заново.") from exc
    if payload != {"definition": DEFINITION_HASH}:
        raise ValidationError("Версия опросника изменилась. Откройте новую форму.")


def score(answers):
    if not isinstance(answers, dict) or set(answers) != set(KEYS):
        raise ValidationError("Нужны все девять ответов или явных пропусков.")
    if any(value is not None and (type(value) is not int or value not in range(4)) for value in answers.values()):
        raise ValidationError("Недопустимое значение ответа.")
    completed = sum(value is not None for value in answers.values())
    return (sum(answers.values()) if completed == 9 else None), completed


@transaction.atomic
def submit_assessment(patient, *, submission_key, content_token, answers, difficulty):
    require_demo()
    relation = _patient_relation(patient)
    validate_token(content_token)
    total, completed = score(answers)
    if difficulty is not None and (type(difficulty) is not int or difficulty not in range(4)):
        raise ValidationError("Неверный ответ о повседневных затруднениях.")
    if any(value is not None and value > 0 for value in answers.values()) and difficulty is None:
        raise ValidationError("Укажите, насколько отмеченные проблемы затрудняли повседневную жизнь.")

    def retry(existing):
        if existing.patient_id != patient.pk:
            raise PermissionDenied
        if (existing.answers, existing.difficulty, existing.definition_sha256) != (answers, difficulty, DEFINITION_HASH):
            raise ValidationError("Повтор содержит другие данные. Откройте новую форму.")
        return existing, False

    existing = Assessment.objects.filter(submission_key=submission_key).first()
    if existing:
        return retry(existing)
    end = timezone.localdate()
    try:
        with transaction.atomic():
            result = Assessment.objects.create(patient=patient, relationship=relation, submission_key=submission_key,
                instrument_code=DEFINITION["code"], instrument_version=DEFINITION["version"],
                definition_sha256=DEFINITION_HASH, definition=DEFINITION, answers=answers, difficulty=difficulty,
                total=total, completed_count=completed, period_start=end - timedelta(days=13), period_end=end)
    except IntegrityError:
        return retry(Assessment.objects.get(submission_key=submission_key))
    if answers["q9"] is None or answers["q9"] > 0:
        AssessmentAttention.objects.create(assessment=result, reason="q9_missing" if answers["q9"] is None else "q9_positive")
    audit(patient, "assessment.submitted", result.pk, relationship_id=str(relation.pk), instrument_version=result.instrument_version)
    return result, True


def doctor_assessment(doctor, assessment_id):
    require_demo()
    require_role(doctor, User.Role.DOCTOR)
    result = Assessment.objects.select_for_update().filter(pk=assessment_id, relationship__doctor=doctor,
        relationship__is_active=True, patient__is_active=True).first()
    if result is None:
        raise PermissionDenied
    return result


@transaction.atomic
def review_assessment(doctor, assessment_id):
    result = doctor_assessment(doctor, assessment_id)
    # Serialize with relationship changes on PostgreSQL.
    type(result.relationship).objects.select_for_update().get(pk=result.relationship_id, is_active=True)
    review, created = AssessmentReview.objects.get_or_create(assessment=result, defaults={"doctor": doctor})
    if created:
        audit(doctor, "assessment.reviewed", result.pk, relationship_id=str(result.relationship_id))
    return review


@transaction.atomic
def acknowledge_attention(doctor, assessment_id):
    result = doctor_assessment(doctor, assessment_id)
    type(result.relationship).objects.select_for_update().get(pk=result.relationship_id, is_active=True)
    attention = AssessmentAttention.objects.filter(assessment=result).first()
    if attention is None:
        raise ValidationError("У этого опросника нет отдельной отметки внимания.")
    changed = AssessmentAttention.objects.filter(pk=attention.pk, acknowledged_at__isnull=True).update(
        acknowledged_by=doctor, acknowledged_at=timezone.now())
    if changed:
        audit(doctor, "assessment.attention_acknowledged", result.pk, relationship_id=str(result.relationship_id))
    return attention


def result_rows(result):
    options = {value: label for value, label in result.definition["options"]}
    return [{"number": i + 1, "question": item["text"], "answer": options.get(result.answers.get(item["key"]), "Пропущен"),
             "value": result.answers.get(item["key"])} for i, item in enumerate(result.definition["items"])]


def timeline(results):
    """Chronological discrete scores; incomplete results break the difference comparison."""
    previous = None
    rows = []
    timestamp_counts = Counter(result.created_at for result in results)
    for result in sorted(results, key=lambda item: (item.created_at, str(item.pk))):
        delta = None
        if (result.total is not None and previous is not None and previous.total is not None
                and previous.definition_sha256 == result.definition_sha256
                and timestamp_counts[result.created_at] == 1 and timestamp_counts[previous.created_at] == 1):
            delta = result.total - previous.total
        rows.append({"result": result, "delta": delta})
        previous = result
    return list(reversed(rows))
