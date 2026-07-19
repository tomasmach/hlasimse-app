from django.contrib import admin
from django.urls import include, path

from core.health_views import live_health, ready_health

urlpatterns = [
    path("health/live/", live_health, name="health-live"),
    path("health/ready/", ready_health, name="health-ready"),
    path("admin/", admin.site.urls),
    path("api/v1/", include("core.urls")),
    path("", include("core.web_urls")),
]
