from datetime import UTC, datetime, timedelta

from django.db import connection
from django.db.models import Exists, Min, OuterRef
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from .health import ALERT_EVENT_TYPES, REQUIRED_DELIVERY_WORKERS
from .models import (
    AlertIncident,
    CheckInProfile,
    DeliveryAttempt,
    OutboxEvent,
    WorkerHeartbeat,
)

DEFAULT_HEARTBEAT_MAX_AGE = timedelta(minutes=5)


def _database_now() -> datetime:
    with connection.cursor() as cursor:
        cursor.execute("SELECT CURRENT_TIMESTAMP")
        value = cursor.fetchone()[0]
    if isinstance(value, str):
        value = parse_datetime(value)
    if value is None:
        raise RuntimeError("Database did not return a valid current timestamp.")
    if timezone.is_naive(value):
        value = timezone.make_aware(value, UTC)
    return value


def _seconds(value: timedelta) -> float:
    return round(value.total_seconds(), 3)


def _age_seconds(*, now: datetime, then: datetime | None) -> float | None:
    if then is None:
        return None
    return max(_seconds(now - then), 0.0)


def safety_metrics_snapshot(
    *,
    app_now: datetime | None = None,
    database_now: datetime | None = None,
    heartbeat_max_age: timedelta = DEFAULT_HEARTBEAT_MAX_AGE,
) -> dict:
    """Return one provider-neutral aggregate snapshot without user or domain identifiers."""
    if database_now is None:
        app_before_query = timezone.now()
        database_now = _database_now()
        app_after_query = timezone.now()
        if app_now is None:
            app_now = app_before_query + (app_after_query - app_before_query) / 2
    elif app_now is None:
        app_now = timezone.now()

    current_generation_incident = AlertIncident.objects.filter(
        profile_id=OuterRef("pk"),
        deadline_generation=OuterRef("deadline_generation"),
    )
    eligible_deadlines = (
        CheckInProfile.objects.filter(
            archived_at__isnull=True,
            enabled=True,
            is_paused=False,
            next_deadline_at__isnull=False,
            next_deadline_at__lte=database_now,
        )
        .annotate(current_generation_materialized=Exists(current_generation_incident))
        .filter(current_generation_materialized=False)
    )
    oldest_due_at = eligible_deadlines.aggregate(value=Min("next_deadline_at"))["value"]

    pending_alerts = OutboxEvent.objects.filter(
        event_type__in=ALERT_EVENT_TYPES,
        status=OutboxEvent.Status.PENDING,
    )
    oldest_pending_alert_at = pending_alerts.aggregate(value=Min("created_at"))["value"]

    heartbeats = list(
        WorkerHeartbeat.objects.filter(worker_name__in=REQUIRED_DELIVERY_WORKERS).only(
            "worker_name", "last_seen_at", "details"
        )
    )
    heartbeat_ages = [
        _age_seconds(now=database_now, then=heartbeat.last_seen_at) for heartbeat in heartbeats
    ]
    heartbeat_max_age_seconds = _seconds(heartbeat_max_age)

    return {
        "schema_version": 1,
        "observed_at": app_now.isoformat(),
        "clock": {
            "app_time": app_now.isoformat(),
            "database_time": database_now.isoformat(),
            "app_minus_database_seconds": _seconds(app_now - database_now),
        },
        "deadlines": {
            "eligible_count": eligible_deadlines.count(),
            "oldest_due_age_seconds": _age_seconds(now=database_now, then=oldest_due_at),
            "current_generation_incident_gap_count": eligible_deadlines.count(),
        },
        "incidents": {
            "open_count": AlertIncident.objects.filter(status=AlertIncident.Status.OPEN).count(),
        },
        "alert_outbox": {
            "pending_count": pending_alerts.count(),
            "oldest_pending_age_seconds": _age_seconds(
                now=database_now,
                then=oldest_pending_alert_at,
            ),
        },
        "delivery": {
            "dead_letter_count": DeliveryAttempt.objects.filter(
                status=DeliveryAttempt.Status.DEAD_LETTER
            ).count(),
        },
        "workers": {
            "required_count": len(REQUIRED_DELIVERY_WORKERS),
            "reported_count": len(heartbeats),
            "missing_count": len(REQUIRED_DELIVERY_WORKERS) - len(heartbeats),
            "heartbeat_max_age_seconds": heartbeat_max_age_seconds,
            "oldest_heartbeat_age_seconds": max(heartbeat_ages, default=None),
            "stale_count": sum(
                age is not None and age > heartbeat_max_age_seconds for age in heartbeat_ages
            ),
            "failing_count": sum(
                heartbeat.details.get("healthy") is False for heartbeat in heartbeats
            ),
        },
    }
