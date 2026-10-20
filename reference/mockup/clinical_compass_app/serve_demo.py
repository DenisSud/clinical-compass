"""Loopback-only demo server, including static assets; not a production entry point."""
import os
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
from config.wsgi import application
from django.conf import settings
from django.contrib.staticfiles.handlers import StaticFilesHandler
from waitress import serve

def main():
    if not settings.DEMO_MODE:
        raise SystemExit("Use the normal WSGI entry point for deployment; this server is demo-only.")
    port = int(os.getenv("COMPASS_PORT", "8000"))
    print(f"Clinical Compass demo: http://127.0.0.1:{port}/", flush=True)
    serve(StaticFilesHandler(application), host="127.0.0.1", port=port, threads=4)


if __name__ == "__main__":
    main()
