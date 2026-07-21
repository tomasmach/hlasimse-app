from django.conf import settings
from django.contrib import admin
from django.urls import include, path

from core.health_views import live_health, mobile_client_config, ready_health

urlpatterns = [
    path("health/live/", live_health, name="health-live"),
    path("health/ready/", ready_health, name="health-ready"),
    path("api/v1/client-config/", mobile_client_config, name="mobile-client-config"),
    path("api/v1/", include("core.urls")),
    path("", include("core.web_urls")),
]
if settings.ADMIN_ENABLED:
    urlpatterns.insert(3, path("admin/", admin.site.urls))
