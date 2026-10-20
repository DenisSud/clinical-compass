import os
from pathlib import Path
from django.core.exceptions import ImproperlyConfigured
from django.core.management.utils import get_random_secret_key

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(exist_ok=True)
DEMO_MODE = os.getenv("COMPASS_DEMO", "1") == "1"
DEBUG = os.getenv("DJANGO_DEBUG", "0") == "1"
SECRET_KEY = os.getenv("DJANGO_SECRET_KEY", "")
if not SECRET_KEY:
    if not DEMO_MODE:
        raise ImproperlyConfigured("DJANGO_SECRET_KEY is required outside the local demo")
    secret_path = DATA_DIR / ".secret-key"
    try:
        with secret_path.open("x", encoding="utf-8") as handle:
            handle.write(get_random_secret_key())
    except FileExistsError:
        pass
    SECRET_KEY = secret_path.read_text(encoding="utf-8")

ALLOWED_HOSTS = os.getenv("DJANGO_ALLOWED_HOSTS", "127.0.0.1,localhost,[::1]").split(",")
INSTALLED_APPS = [
    "django.contrib.auth", "django.contrib.contenttypes", "django.contrib.sessions",
    "django.contrib.messages", "django.contrib.staticfiles", "care",
]
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "care.middleware.PrivateResponseMiddleware",
]
ROOT_URLCONF = "config.urls"
TEMPLATES = [{
    "BACKEND": "django.template.backends.django.DjangoTemplates",
    "DIRS": [BASE_DIR / "templates"], "APP_DIRS": True,
    "OPTIONS": {"context_processors": [
        "django.template.context_processors.request", "django.contrib.auth.context_processors.auth",
        "django.contrib.messages.context_processors.messages", "care.context_processors.app_context",
    ]},
}]
WSGI_APPLICATION = "config.wsgi.application"
if os.getenv("COMPASS_DB", "sqlite") == "postgres":
    DATABASES = {"default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": os.getenv("POSTGRES_DB", "compass"),
        "USER": os.getenv("POSTGRES_USER", "compass"),
        "PASSWORD": os.environ["POSTGRES_PASSWORD"],
        "HOST": os.getenv("POSTGRES_HOST", "127.0.0.1"),
        "PORT": os.getenv("POSTGRES_PORT", "5432"), "CONN_MAX_AGE": 0,
    }}
else:
    if not DEMO_MODE:
        raise ImproperlyConfigured("Use COMPASS_DB=postgres outside the local demo")
    DATABASES = {"default": {
        "ENGINE": "django.db.backends.sqlite3", "NAME": DATA_DIR / "demo.sqlite3",
        "OPTIONS": {"timeout": 20},
    }}
AUTH_USER_MODEL = "care.User"
AUTHENTICATION_BACKENDS = ["care.auth.ThrottledBackend"]
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]
LANGUAGE_CODE = "ru"
TIME_ZONE = "Europe/Moscow"
USE_I18N = True
USE_TZ = True
STATIC_URL = "/static/"
STATICFILES_DIRS = [BASE_DIR / "static"]
STATIC_ROOT = BASE_DIR / "staticfiles"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
LOGIN_URL = "/login/"
LOGIN_REDIRECT_URL = "/"
LOGOUT_REDIRECT_URL = "/login/"
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_SECURE = not DEMO_MODE
SESSION_COOKIE_AGE = 3600
CSRF_COOKIE_SECURE = not DEMO_MODE
SECURE_SSL_REDIRECT = not DEMO_MODE
SECURE_HSTS_SECONDS = 31536000 if not DEMO_MODE else 0
SECURE_HSTS_INCLUDE_SUBDOMAINS = not DEMO_MODE
SECURE_HSTS_PRELOAD = not DEMO_MODE
X_FRAME_OPTIONS = "DENY"
SECURE_CONTENT_TYPE_NOSNIFF = True
# Shared database cache makes the login throttle survive process restarts.
CACHES = {"default": {
    "BACKEND": "django.core.cache.backends.db.DatabaseCache",
    "LOCATION": "compass_cache", "TIMEOUT": 600,
}}
LOGIN_MAX_FAILURES = 5
LOGIN_LOCK_SECONDS = 600
