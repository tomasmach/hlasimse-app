from unittest.mock import patch

import pytest
from django.db import OperationalError


def test_liveness_is_public_and_does_not_require_database(client):
    response = client.get("/health/live/")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    assert response["Cache-Control"] == "max-age=0, no-cache, no-store, must-revalidate, private"


@pytest.mark.django_db
def test_readiness_succeeds_when_database_and_migrations_are_ready(client):
    response = client.get("/health/ready/")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


@pytest.mark.django_db
def test_readiness_fails_closed_without_exposing_database_error(client):
    with patch("core.health_views.connection.cursor", side_effect=OperationalError("secret")):
        response = client.get("/health/ready/")

    assert response.status_code == 503
    assert response.json() == {"status": "unavailable"}
    assert b"secret" not in response.content


@pytest.mark.django_db
def test_readiness_fails_when_shared_cache_cannot_round_trip(client):
    with patch("core.health_views.cache.get", return_value=None):
        response = client.get("/health/ready/")

    assert response.status_code == 503
    assert response.json() == {"status": "unavailable"}
