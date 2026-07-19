import pytest
from rest_framework.test import APIClient

from core.models import CheckInProfile, User
from core.services import create_profile


@pytest.fixture
def api_client():
    return APIClient()


@pytest.fixture
def user(db):
    return User.objects.create_user(
        email="owner@example.cz",
        password="Safely-testing-123",
        first_name="Jan",
        last_name="Novák",
    )


@pytest.fixture
def other_user(db):
    return User.objects.create_user(
        email="other@example.cz",
        password="Safely-testing-123",
        first_name="Eva",
        last_name="Jiná",
    )


@pytest.fixture
def profile(user) -> CheckInProfile:
    return create_profile(owner=user, name="Jan", interval_seconds=86_400)
