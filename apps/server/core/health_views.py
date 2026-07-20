from uuid import uuid4

from django.conf import settings
from django.core.cache import cache
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.http import JsonResponse
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_GET


@require_GET
@never_cache
def mobile_client_config(request):
    return JsonResponse(
        {
            "client": "hlasimse-mobile",
            "maintenance": settings.MOBILE_API_MAINTENANCE,
            "platforms": {
                platform: {
                    "min_version": release["min_version"],
                    "min_build": release["min_build"],
                    "store_url": release["store_url"],
                }
                for platform, release in settings.MOBILE_RELEASES.items()
            },
        }
    )


@require_GET
@never_cache
def live_health(request):
    """Process liveness probe that deliberately avoids external dependencies."""
    return JsonResponse({"status": "ok"})


@require_GET
@never_cache
def ready_health(request):
    """Readiness probe for database, shared cache, and unapplied migrations."""
    cache_key = f"readiness:{uuid4()}"
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
        executor = MigrationExecutor(connection)
        pending_migrations = executor.migration_plan(executor.loader.graph.leaf_nodes())
        cache.set(cache_key, "ok", timeout=5)
        cache_ready = cache.get(cache_key) == "ok"
        cache.delete(cache_key)
    except Exception:  # noqa: BLE001 - probes must fail closed without leaking internals
        return JsonResponse({"status": "unavailable"}, status=503)

    if pending_migrations:
        return JsonResponse({"status": "migrations_pending"}, status=503)
    if not cache_ready:
        return JsonResponse({"status": "unavailable"}, status=503)
    return JsonResponse({"status": "ok"})
