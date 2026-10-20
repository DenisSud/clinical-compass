from django.conf import settings

def app_context(request):
    return {"demo_mode": settings.DEMO_MODE, "app_version": "0.3.0"}
