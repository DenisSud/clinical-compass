from pathlib import Path
from django.conf import settings
from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError
from care.models import User


class Command(BaseCommand):
    help = "Import nonclinical synthetic knowledge fixture; no approved clinical content."

    def handle(self, *args, **options):
        if not settings.DEMO_MODE:
            raise CommandError("Synthetic seeding requires COMPASS_DEMO=1")
        actor, created = User.objects.get_or_create(username="knowledge_demo_importer", defaults={
            "role": User.Role.OPERATOR, "display_name": "Импортёр синтетического примера"})
        if actor.role != User.Role.OPERATOR or not actor.is_active:
            raise CommandError("Demo importer account role/status mismatch")
        if created:
            actor.set_unusable_password()
            actor.save(update_fields=["password"])
        call_command("import_knowledge", str(Path(settings.BASE_DIR) / "knowledge_examples" / "synthetic_bundle.json"),
                     actor=actor.username, stdout=self.stdout)
        call_command("import_knowledge", str(Path(settings.BASE_DIR) / "care" / "instruments" / "phq9_reference_bundle.json"),
                     actor=actor.username, stdout=self.stdout)
        # The small runnable distribution carries the team's source bundles here.
        # Import through the same validation path; every source stays unverified.
        for bundle in sorted((Path(settings.BASE_DIR) / "knowledge_examples" / "team_sources").glob("*.json")):
            call_command("import_knowledge", str(bundle), actor=actor.username, stdout=self.stdout)
