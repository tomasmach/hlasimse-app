import hashlib
from pathlib import Path

import pytest
from rest_framework.test import APIClient

from core.legal_documents import load_legal_document_set
from core.models import CheckInProfile, User
from core.services import create_profile

LEGAL_FIXTURE_DIR = Path(__file__).parent / "fixtures" / "legal"


def _fixture_sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


@pytest.fixture(autouse=True)
def published_test_legal_documents(settings):
    privacy_path = LEGAL_FIXTURE_DIR / "privacy.json"
    terms_path = LEGAL_FIXTURE_DIR / "terms.json"
    settings.LEGAL_PRIVACY_VERSION = "test-privacy-v1"
    settings.LEGAL_TERMS_VERSION = "test-terms-v1"
    settings.LEGAL_DOCUMENTS = load_legal_document_set(
        privacy_path=str(privacy_path),
        privacy_version=settings.LEGAL_PRIVACY_VERSION,
        privacy_sha256=_fixture_sha256(privacy_path),
        terms_path=str(terms_path),
        terms_version=settings.LEGAL_TERMS_VERSION,
        terms_sha256=_fixture_sha256(terms_path),
    )


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
