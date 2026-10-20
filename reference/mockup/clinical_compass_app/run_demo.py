"""One-command initialization and local launch; never changes PowerShell policies."""
import os
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
import django
django.setup()
from django.conf import settings
from django.core.management import call_command

if __name__ == "__main__":
    if not settings.DEMO_MODE:
        raise SystemExit("This launcher requires COMPASS_DEMO=1")
    call_command("migrate", interactive=False)
    call_command("createcachetable")
    call_command("seed_demo")
    call_command("seed_knowledge_demo")
    from serve_demo import main
    main()
