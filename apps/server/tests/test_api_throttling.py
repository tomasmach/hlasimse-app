import pytest
from django.test import override_settings
from rest_framework.test import APIRequestFactory

from core.views import RegistrationThrottle

pytestmark = pytest.mark.django_db


def test_api_throttle_ignores_forwarded_header_from_untrusted_peer():
    request = APIRequestFactory().post(
        "/api/v1/auth/register/",
        {},
        REMOTE_ADDR="203.0.113.9",
        HTTP_X_FORWARDED_FOR="198.51.100.44",
    )

    assert RegistrationThrottle().get_ident(request) == "203.0.113.9"


@override_settings(WEB_TRUSTED_PROXY_CIDRS=("10.0.0.0/8",))
def test_api_throttle_walks_only_the_trusted_proxy_suffix():
    request = APIRequestFactory().post(
        "/api/v1/auth/register/",
        {},
        REMOTE_ADDR="10.0.0.3",
        HTTP_X_FORWARDED_FOR="198.51.100.44, 10.0.0.2",
    )

    assert RegistrationThrottle().get_ident(request) == "198.51.100.44"
