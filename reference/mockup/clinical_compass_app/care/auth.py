import hashlib
from django.conf import settings
from django.contrib.auth.backends import ModelBackend
from django.core.cache import cache


class ThrottledBackend(ModelBackend):
    """Minimal account throttle; shared DB cache, no raw login in keys.

    The inactivity window is extended on failure; increments are best-effort,
    not a substitute for a concurrency-safe perimeter limiter in production.
    """
    def authenticate(self, request, username=None, password=None, **kwargs):
        if username is None:
            return None
        digest = hashlib.sha256(username.strip().casefold().encode()).hexdigest()
        key = "login-fail:" + digest
        attempts = cache.get(key, 0)
        if attempts >= settings.LOGIN_MAX_FAILURES:
            return None
        user = super().authenticate(request, username=username, password=password, **kwargs)
        if user is None:
            cache.set(key, attempts + 1, settings.LOGIN_LOCK_SECONDS)
        else:
            cache.delete(key)
        return user
