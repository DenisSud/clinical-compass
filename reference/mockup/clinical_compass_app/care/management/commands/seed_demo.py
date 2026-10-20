import os
import uuid
from datetime import date, datetime, time, timedelta
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone
from care.models import CareRelationship, SelfReport, User
from care.services import submit_report, submit_request


class Command(BaseCommand):
    help = "Create only synthetic demo accounts/data; idempotent for a given reference date."

    def add_arguments(self, parser):
        parser.add_argument("--reference-date", type=date.fromisoformat, default=None)

    @transaction.atomic
    def handle(self, *args, **options):
        if not settings.DEMO_MODE:
            raise CommandError("Synthetic demo seeding is disabled outside COMPASS_DEMO=1")
        reference = options["reference_date"] or timezone.localdate()
        if reference > timezone.localdate():
            raise CommandError("The demo reference date cannot be in the future")
        password = os.getenv("COMPASS_DEMO_PASSWORD", "CompassDemo!2026")
        users = {}
        entries = [
            ("doctor_demo", User.Role.DOCTOR, "Врач Демо 01"),
            ("doctor_other", User.Role.DOCTOR, "Врач Демо 02"),
            ("patient_demo", User.Role.PATIENT, "Пациент Демо 01"),
            ("patient_other", User.Role.PATIENT, "Пациент Демо 02"),
            ("patient_new", User.Role.PATIENT, "Пациент без привязки"),
        ]
        for name, role, label in entries:
            user, created = User.objects.get_or_create(username=name, defaults={"role": role, "display_name": label})
            if user.role != role:
                raise CommandError(f"Existing role mismatch for {name}; refusing to overwrite")
            if created:
                user.set_password(password)
                user.save(update_fields=["password"])
            users[name] = user
        for doctor_name, patient_name in [("doctor_demo", "patient_demo"), ("doctor_other", "patient_other")]:
            patient, doctor = users[patient_name], users[doctor_name]
            active = CareRelationship.objects.filter(patient=patient, is_active=True).first()
            if active and active.doctor_id != doctor.pk:
                raise CommandError("Demo patient is already associated with another doctor")
            # Preserve a deliberately ended relationship; rerunning seed must not restore access.
            if not active and CareRelationship.objects.filter(patient=patient).exists():
                continue
            CareRelationship.objects.get_or_create(patient=patient, doctor=doctor, is_active=True)
            for offset, score, note in [
                (6, 5, "Записываю первые наблюдения в дневник."),
                (4, None, "Сегодня предпочитаю оставить только комментарий."),
                (2, 6, "Удалось вернуться к привычному режиму дня."),
                (0, 7, "Хочу обсудить наблюдения на следующей встрече."),
            ]:
                day = reference - timedelta(days=offset)
                key = uuid.uuid5(uuid.NAMESPACE_URL, f"compass-demo:{patient_name}:{day}")
                # Rolling reference dates reuse calendar days at different offsets.
                # Keep the first seeded observation rather than resubmit a new value.
                if SelfReport.objects.filter(submission_key=key, patient=patient, reported_for=day).exists():
                    continue
                report, created = submit_report(patient, submission_key=key, wellbeing=score, note=note, reported_for=day)
                if created:
                    stamp = timezone.make_aware(datetime.combine(day, time(10, 0)))
                    type(report).objects.filter(pk=report.pk).update(created_at=stamp)
            submit_request(patient, submission_key=uuid.uuid5(uuid.NAMESPACE_URL, f"compass-request:{patient_name}"),
                           category="organization", body="Где в кабинете посмотреть мои прошлые наблюдения?")
        self.stdout.write(self.style.SUCCESS("Synthetic demo ready. Existing passwords and ended links were not overwritten."))
        self.stdout.write("Accounts: doctor_demo, doctor_other, patient_demo, patient_other, patient_new")
