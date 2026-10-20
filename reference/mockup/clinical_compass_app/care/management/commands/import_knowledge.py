import json
from pathlib import Path
from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError
from care.knowledge import MAX_BUNDLE_BYTES, import_bundle
from care.models import User


def no_duplicate_keys(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON key")
        result[key] = value
    return result


class Command(BaseCommand):
    help = "Import a local UTF-8 knowledge bundle into unverified staging; no URL fetch or activation."

    def add_arguments(self, parser):
        parser.add_argument("bundle", type=Path)
        parser.add_argument("--actor", required=True, help="Existing active operator username")

    def handle(self, *args, **options):
        try:
            actor = User.objects.get(username=options["actor"], role=User.Role.OPERATOR, is_active=True)
        except User.DoesNotExist as exc:
            raise CommandError("An existing active operator account is required") from exc
        try:
            with options["bundle"].open("rb") as handle:
                raw = handle.read(MAX_BUNDLE_BYTES + 1)
            if len(raw) > MAX_BUNDLE_BYTES:
                raise ValueError("Bundle exceeds 4 MB")
            bundle = json.loads(raw.decode("utf-8-sig"), object_pairs_hook=no_duplicate_keys)
            source, created = import_bundle(actor, bundle)
        except (OSError, ValueError, RecursionError, ValidationError) as exc:
            # Do not print document text, paths or any patient content on failure.
            if isinstance(exc, ValidationError):
                raise CommandError(" ".join(exc.messages)) from exc
            raise CommandError("Cannot read bundle: require bounded UTF-8 JSON without duplicate keys") from exc
        self.stdout.write(f"{'Imported unverified' if created else 'Already imported'}: {source.pk}")
