from datetime import timedelta
from io import StringIO

import pytest
from django.contrib.sessions.models import Session
from django.core.management import CommandError, call_command
from django.utils import timezone

pytestmark = pytest.mark.django_db


def _session(*, key: str, expires_at) -> Session:
    return Session.objects.create(
        session_key=key,
        session_data="e30:1test:invalid-signature-is-fine-for-retention-tests",
        expire_date=expires_at,
    )


def test_purge_expired_sessions_is_bounded_and_preserves_active_sessions():
    now = timezone.now()
    expired = [
        _session(key=f"expired-{index}", expires_at=now - timedelta(minutes=index + 1))
        for index in range(3)
    ]
    active = _session(key="active", expires_at=now + timedelta(days=1))
    stdout = StringIO()

    call_command("purge_expired_sessions", batch_size=1, stdout=stdout)

    assert not Session.objects.filter(pk__in=[session.pk for session in expired]).exists()
    assert Session.objects.filter(pk=active.pk).exists()
    assert "sessions_deleted=3" in stdout.getvalue()
    assert "sessions_deleted_total=3" in stdout.getvalue()


@pytest.mark.parametrize(
    "options",
    [
        {"batch_size": 0},
        {"batch_size": 10_001},
        {"watch": True, "poll_interval": 59},
    ],
)
def test_purge_expired_sessions_rejects_unsafe_runtime_bounds(options):
    with pytest.raises(CommandError):
        call_command("purge_expired_sessions", **options)
