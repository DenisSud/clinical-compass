import uuid
from django.conf import settings
from django.contrib.auth.models import AbstractUser
from django.core.exceptions import ValidationError
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.db.models import Q
from django.utils import timezone


class User(AbstractUser):
    class Role(models.TextChoices):
        DOCTOR = "doctor", "Врач"
        PATIENT = "patient", "Пациент"
        OPERATOR = "operator", "Оператор"
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    role = models.CharField(max_length=16, choices=Role.choices, default=Role.PATIENT)
    display_name = models.CharField(max_length=100)

    @property
    def label(self):
        return self.display_name or self.username


class CareRelationship(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    doctor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="care_patients")
    patient = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="care_doctors")
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(default=timezone.now)
    ended_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["patient"], condition=Q(is_active=True), name="one_active_doctor_per_patient"),
            models.CheckConstraint(condition=~Q(doctor=models.F("patient")), name="different_doctor_patient"),
        ]
        indexes = [models.Index(fields=["doctor", "is_active"])]

    def clean(self):
        if self.doctor.role != User.Role.DOCTOR or self.patient.role != User.Role.PATIENT:
            raise ValidationError("Связь требует роль врача и роль пациента.")


class Invitation(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    doctor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    token_hash = models.CharField(max_length=64, unique=True)
    created_at = models.DateTimeField(default=timezone.now)
    expires_at = models.DateTimeField()
    used_at = models.DateTimeField(null=True, blank=True)
    used_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.PROTECT, related_name="used_invitations")
    revoked_at = models.DateTimeField(null=True, blank=True)


class SelfReport(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    patient = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    relationship = models.ForeignKey(CareRelationship, on_delete=models.PROTECT)
    submission_key = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    wellbeing = models.PositiveSmallIntegerField(null=True, blank=True, validators=[MinValueValidator(1), MaxValueValidator(10)])
    note = models.TextField(max_length=2000, blank=True)
    reported_for = models.DateField()
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["patient", "-created_at"])]
        constraints = [models.CheckConstraint(condition=Q(wellbeing__isnull=True) | Q(wellbeing__gte=1, wellbeing__lte=10), name="wellbeing_range")]

    def clean(self):
        if self.relationship.patient_id != self.patient_id:
            raise ValidationError("Пациент и связь не совпадают.")
        if self.reported_for > timezone.localdate():
            raise ValidationError("Дата самоотчёта не может быть в будущем.")


class ReportReview(models.Model):
    report = models.OneToOneField(SelfReport, on_delete=models.PROTECT, related_name="review")
    doctor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    reviewed_at = models.DateTimeField(default=timezone.now)


class SupportRequest(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    class Category(models.TextChoices):
        QUESTION = "question", "Вопрос врачу"
        ORGANIZATION = "organization", "Организационный вопрос"
        REPORT = "report", "Уточнение самоотчёта"
    relationship = models.ForeignKey(CareRelationship, on_delete=models.PROTECT)
    patient = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="support_requests")
    submission_key = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    category = models.CharField(max_length=20, choices=Category.choices)
    body = models.TextField(max_length=2000)
    created_at = models.DateTimeField(default=timezone.now)
    response = models.TextField(max_length=3000, blank=True)
    answered_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.PROTECT, related_name="support_answers")
    answered_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]


class Assessment(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    patient = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    relationship = models.ForeignKey(CareRelationship, on_delete=models.PROTECT)
    submission_key = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    instrument_code = models.CharField(max_length=40)
    instrument_version = models.CharField(max_length=100)
    definition_sha256 = models.CharField(max_length=64)
    definition = models.JSONField()
    answers = models.JSONField()
    difficulty = models.PositiveSmallIntegerField(null=True, blank=True)
    total = models.PositiveSmallIntegerField(null=True, blank=True)
    completed_count = models.PositiveSmallIntegerField()
    period_start = models.DateField()
    period_end = models.DateField()
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["relationship", "-created_at"])]
        constraints = [
            models.CheckConstraint(condition=Q(total__isnull=True) | Q(total__gte=0, total__lte=27), name="phq9_total_range"),
            models.CheckConstraint(condition=Q(difficulty__isnull=True) | Q(difficulty__gte=0, difficulty__lte=3), name="assessment_difficulty_range"),
            models.CheckConstraint(condition=Q(completed_count__gte=0, completed_count__lte=9), name="assessment_answer_count"),
            models.CheckConstraint(condition=Q(period_end__gte=models.F("period_start")), name="assessment_period_order"),
        ]


class AssessmentReview(models.Model):
    assessment = models.OneToOneField(Assessment, on_delete=models.PROTECT, related_name="review")
    doctor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    reviewed_at = models.DateTimeField(default=timezone.now)


class AssessmentAttention(models.Model):
    assessment = models.OneToOneField(Assessment, on_delete=models.PROTECT, related_name="attention")
    reason = models.CharField(max_length=30)
    created_at = models.DateTimeField(default=timezone.now)
    acknowledged_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.PROTECT)
    acknowledged_at = models.DateTimeField(null=True, blank=True)


class SourceDocument(models.Model):
    """Source version; imported snapshots remain unverified in this release."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    title = models.CharField(max_length=250)
    version = models.CharField(max_length=80)
    url = models.URLField(blank=True)
    sha256 = models.CharField(max_length=64, blank=True)
    section = models.CharField(max_length=200, blank=True)
    kind = models.CharField(max_length=20, default="unspecified")
    publisher = models.CharField(max_length=200, blank=True)
    language = models.CharField(max_length=20, default="ru")
    applicability = models.TextField(max_length=2000, blank=True)
    usage_rights = models.TextField(max_length=2000, blank=True)
    retrieved_on = models.DateField(null=True, blank=True)
    original_filename = models.CharField(max_length=250, blank=True)
    original_sha256 = models.CharField(max_length=64, blank=True)
    extraction_notes = models.TextField(max_length=2000, blank=True)
    review_status = models.CharField(max_length=20, default="unverified", editable=False)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["title", "version"], name="unique_source_version")]

    @property
    def kind_label(self):
        return {"guideline": "Клинические рекомендации", "label": "Инструкция препарата", "scale": "Шкала",
                "synthetic": "Синтетический пример"}.get(self.kind, "Тип не указан")

    @property
    def display_title(self):
        title = self.title
        for marker in [" — предоставленные", " — предоставленный", " — предоставленная"]:
            title = title.split(marker)[0]
        return title.replace("Синтетический демоисточник — проверка привязки", "Учебный пример: работа с источниками")


class KnowledgeSnapshot(models.Model):
    source = models.OneToOneField(SourceDocument, on_delete=models.PROTECT, related_name="snapshot")
    text = models.TextField()
    text_sha256 = models.CharField(max_length=64)
    bundle_sha256 = models.CharField(max_length=64)
    imported_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    created_at = models.DateTimeField(default=timezone.now)


class KnowledgePassage(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    source = models.ForeignKey(SourceDocument, on_delete=models.PROTECT, related_name="passages")
    key = models.CharField(max_length=80)
    locator = models.CharField(max_length=250)
    start = models.PositiveIntegerField()
    end = models.PositiveIntegerField()
    text = models.TextField()
    sha256 = models.CharField(max_length=64)

    class Meta:
        ordering = ["source_id", "start", "key"]
        constraints = [
            models.UniqueConstraint(fields=["source", "key"], name="unique_passage_key"),
            models.CheckConstraint(condition=Q(end__gt=models.F("start")), name="passage_positive_span"),
        ]


class ClinicalRuleVersion(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=80)
    version = models.PositiveIntegerField()
    source = models.ForeignKey(SourceDocument, on_delete=models.PROTECT)
    description = models.TextField(blank=True)
    specification = models.JSONField(default=dict)
    status = models.CharField(max_length=20, default="draft", editable=False)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["code", "version"], name="unique_rule_version")]


class AppendOnlyQuerySet(models.QuerySet):
    def update(self, **kwargs):
        raise TypeError("Audit events cannot be updated")

    def delete(self):
        raise TypeError("Audit events cannot be deleted")


class AuditEvent(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    action = models.CharField(max_length=60)
    entity_id = models.UUIDField()
    created_at = models.DateTimeField(default=timezone.now)
    # IDs/statuses only; never raw self-report text, tokens or credentials.
    details = models.JSONField(default=dict)
    objects = AppendOnlyQuerySet.as_manager()

    class Meta:
        ordering = ["-created_at"]

    @property
    def action_label(self):
        return {
            "invitation.created": "Создано приглашение",
            "invitation.revoked": "Приглашение отозвано",
            "relationship.connected": "Пациент подключён",
            "relationship.ended": "Связь завершена",
            "report.submitted": "Самоотчёт сохранён",
            "report.reviewed": "Просмотр самоотчёта отмечен",
            "support.submitted": "Обращение сохранено",
            "support.answered": "Ответ отправлен",
            "patient.viewed": "Карточка открыта",
            "knowledge.imported": "Источник добавлен на проверку",
            "assessment.submitted": "Опросник сохранён",
            "assessment.reviewed": "Просмотр опросника отмечен",
            "assessment.attention_acknowledged": "Ответ на 9-й вопрос принят к разбору",
        }.get(self.action, self.action)

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise TypeError("Audit events cannot be changed")
        return super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise TypeError("Audit events cannot be deleted")
