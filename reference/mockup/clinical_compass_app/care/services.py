import hashlib
import secrets
from datetime import timedelta
from django.core.exceptions import PermissionDenied, ValidationError
from django.db import IntegrityError, transaction
from django.utils import timezone
from .models import (
    AssessmentAttention, AuditEvent, CareRelationship, Invitation, ReportReview, SelfReport,
    SupportRequest, User,
)


def require_role(user, role):
    if not user.is_authenticated or not user.is_active or user.role != role:
        raise PermissionDenied


def audit(actor, action, entity_id, **details):
    return AuditEvent.objects.create(actor=actor, action=action, entity_id=entity_id, details=details)


@transaction.atomic
def issue_invitation(doctor):
    require_role(doctor, User.Role.DOCTOR)
    token = secrets.token_urlsafe(24)
    invitation = Invitation.objects.create(
        doctor=doctor, token_hash=hashlib.sha256(token.encode()).hexdigest(),
        expires_at=timezone.now() + timedelta(hours=48),
    )
    audit(doctor, "invitation.created", invitation.id)
    return token


@transaction.atomic
def accept_invitation(patient, token):
    require_role(patient, User.Role.PATIENT)
    # Serialize association changes for this patient on PostgreSQL.
    User.objects.select_for_update().get(pk=patient.pk)
    if CareRelationship.objects.filter(patient=patient, is_active=True).exists():
        raise ValidationError("У вас уже есть ведущий врач. Сначала необходимо завершить текущую связь.")
    digest = hashlib.sha256(token.strip().encode()).hexdigest()
    invitation = Invitation.objects.select_for_update().filter(token_hash=digest).first()
    now = timezone.now()
    if not invitation or invitation.used_at or invitation.revoked_at or invitation.expires_at <= now or not invitation.doctor.is_active:
        raise ValidationError("Приглашение недействительно, истекло или уже использовано.")
    require_role(invitation.doctor, User.Role.DOCTOR)
    # Conditional claim also prevents reuse where row locks are unavailable.
    claimed = Invitation.objects.filter(pk=invitation.pk, used_at__isnull=True, revoked_at__isnull=True, expires_at__gt=now).update(used_at=now, used_by=patient)
    if not claimed:
        raise ValidationError("Приглашение уже использовано.")
    try:
        with transaction.atomic():
            relation = CareRelationship.objects.create(doctor=invitation.doctor, patient=patient)
    except IntegrityError:
        raise ValidationError("Связь уже создана. Обновите страницу.")
    audit(patient, "relationship.connected", relation.id, doctor_id=str(relation.doctor_id), patient_id=str(patient.pk))
    return relation


def _patient_relation(patient):
    require_role(patient, User.Role.PATIENT)
    relation = CareRelationship.objects.select_for_update().filter(
        patient=patient, is_active=True, doctor__is_active=True, doctor__role=User.Role.DOCTOR,
    ).first()
    if not relation:
        raise ValidationError("Для отправки сначала подключитесь к ведущему врачу.")
    return relation


@transaction.atomic
def submit_report(patient, *, submission_key, wellbeing, note, reported_for):
    relation = _patient_relation(patient)
    existing = SelfReport.objects.filter(submission_key=submission_key).first()
    if existing:
        if existing.patient_id != patient.pk:
            raise PermissionDenied
        if (existing.wellbeing, existing.note, existing.reported_for) != (wellbeing, note, reported_for):
            raise ValidationError("Повторная отправка содержит другие данные. Откройте новую форму.")
        return existing, False
    report = SelfReport(patient=patient, relationship=relation, submission_key=submission_key,
                        wellbeing=wellbeing, note=note, reported_for=reported_for)
    report.full_clean(validate_unique=False)
    try:
        with transaction.atomic():
            report.save(force_insert=True)
    except IntegrityError:
        existing = SelfReport.objects.get(submission_key=submission_key)
        if existing.patient_id != patient.pk:
            raise PermissionDenied
        if (existing.wellbeing, existing.note, existing.reported_for) != (wellbeing, note, reported_for):
            raise ValidationError("Обнаружена отличающаяся повторная отправка.")
        return existing, False
    audit(patient, "report.submitted", report.id, relationship_id=str(relation.pk))
    return report, True


@transaction.atomic
def submit_request(patient, *, submission_key, category, body):
    relation = _patient_relation(patient)
    existing = SupportRequest.objects.filter(submission_key=submission_key).first()
    if existing:
        if existing.patient_id != patient.pk:
            raise PermissionDenied
        if (existing.category, existing.body) != (category, body):
            raise ValidationError("Повторная отправка содержит другие данные.")
        return existing, False
    item = SupportRequest(patient=patient, relationship=relation, submission_key=submission_key, category=category, body=body)
    item.full_clean(validate_unique=False)
    try:
        with transaction.atomic():
            item.save(force_insert=True)
    except IntegrityError:
        existing = SupportRequest.objects.get(submission_key=submission_key)
        if existing.patient_id != patient.pk:
            raise PermissionDenied
        if (existing.category, existing.body) != (category, body):
            raise ValidationError("Обнаружена отличающаяся повторная отправка.")
        return existing, False
    audit(patient, "support.submitted", item.id, relationship_id=str(relation.pk))
    return item, True


@transaction.atomic
def answer_request(doctor, item_id, body):
    require_role(doctor, User.Role.DOCTOR)
    item = SupportRequest.objects.select_for_update().filter(
        pk=item_id, relationship__doctor=doctor, relationship__is_active=True,
        patient__is_active=True,
    ).first()
    if not item:
        raise PermissionDenied
    CareRelationship.objects.select_for_update().get(pk=item.relationship_id, is_active=True)
    if not body.strip() or len(body) > 3000:
        raise ValidationError("Ответ должен содержать от 1 до 3000 символов.")
    if item.answered_at:
        if item.response == body.strip() and item.answered_by_id == doctor.pk:
            return item
        raise ValidationError("Ответ уже отправлен; незаметное изменение не допускается.")
    now = timezone.now()
    changed = SupportRequest.objects.filter(pk=item.pk, answered_at__isnull=True).update(
        response=body.strip(), answered_by=doctor, answered_at=now,
    )
    if not changed:
        raise ValidationError("На обращение уже ответили. Обновите страницу.")
    audit(doctor, "support.answered", item.id, relationship_id=str(item.relationship_id))
    item.refresh_from_db()
    return item


@transaction.atomic
def review_report(doctor, report_id):
    require_role(doctor, User.Role.DOCTOR)
    report = SelfReport.objects.filter(pk=report_id, relationship__doctor=doctor,
                                       relationship__is_active=True, patient__is_active=True).first()
    if not report:
        raise PermissionDenied
    CareRelationship.objects.select_for_update().get(pk=report.relationship_id, is_active=True)
    review, created = ReportReview.objects.get_or_create(report=report, defaults={"doctor": doctor})
    if created:
        audit(doctor, "report.reviewed", report.id)
    return review


@transaction.atomic
def end_relationship(doctor, relation_id):
    require_role(doctor, User.Role.DOCTOR)
    relation = CareRelationship.objects.select_for_update().filter(pk=relation_id, doctor=doctor, is_active=True).first()
    if not relation:
        raise PermissionDenied
    if SupportRequest.objects.filter(relationship=relation, answered_at__isnull=True).exists():
        raise ValidationError("Сначала обработайте открытые обращения пациента.")
    if AssessmentAttention.objects.filter(assessment__relationship=relation, acknowledged_at__isnull=True).exists():
        raise ValidationError("Сначала примите к разбору выделенные ответы опросников.")
    relation.is_active = False
    relation.ended_at = timezone.now()
    relation.save(update_fields=["is_active", "ended_at"])
    audit(doctor, "relationship.ended", relation.pk)


@transaction.atomic
def revoke_invitation(doctor, invitation_id):
    require_role(doctor, User.Role.DOCTOR)
    invitation = Invitation.objects.select_for_update().filter(pk=invitation_id, doctor=doctor, used_at__isnull=True).first()
    if not invitation:
        raise PermissionDenied
    if not invitation.revoked_at:
        invitation.revoked_at = timezone.now()
        invitation.save(update_fields=["revoked_at"])
        audit(doctor, "invitation.revoked", invitation.pk)
