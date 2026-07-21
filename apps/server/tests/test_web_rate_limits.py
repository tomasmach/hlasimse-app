import pytest
from django.contrib.auth.tokens import default_token_generator
from django.core.cache import cache
from django.test import RequestFactory, override_settings
from django.urls import reverse
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode

from core.models import User
from core.web_rate_limits import _client_ip

pytestmark = pytest.mark.django_db


def _rates(scope, *, ip=(1, 60), identity=None):
    configured = {"ip": ip}
    if identity is not None:
        configured["identity"] = identity
    return {scope: configured}


def test_login_returns_clear_429_after_ip_limit(client, user):
    cache.clear()
    endpoint = reverse("accounts:login")
    payload = {"username": user.email, "password": "incorrect-password"}
    with override_settings(WEB_AUTH_RATE_LIMITS=_rates("login")):
        allowed = client.post(endpoint, payload, REMOTE_ADDR="198.51.100.1")
        blocked = client.post(endpoint, payload, REMOTE_ADDR="198.51.100.1")

    assert allowed.status_code == 200
    assert blocked.status_code == 429
    assert blocked["Retry-After"].isdigit()
    assert 1 <= int(blocked["Retry-After"]) <= 60
    assert "no-store" in blocked["Cache-Control"]
    assert "pokusů příliš mnoho" in blocked.content.decode()
    assert "_auth_user_id" not in client.session


def test_registration_is_limited_before_creating_another_account(client):
    cache.clear()
    endpoint = reverse("accounts:register")
    base_payload = {
        "first_name": "Alena",
        "last_name": "Nová",
        "password1": "A-strong-unique-password-123",
        "password2": "A-strong-unique-password-123",
        "terms": "on",
    }
    with override_settings(WEB_AUTH_RATE_LIMITS=_rates("registration")):
        created = client.post(
            endpoint,
            {**base_payload, "email": "first@example.cz"},
            REMOTE_ADDR="198.51.100.2",
        )
        blocked = client.post(
            endpoint,
            {**base_payload, "email": "second@example.cz"},
            REMOTE_ADDR="198.51.100.2",
        )

    assert created.status_code == 302
    assert blocked.status_code == 429
    assert User.objects.filter(email="first@example.cz").exists()
    assert not User.objects.filter(email="second@example.cz").exists()


def test_password_reset_request_is_limited_without_enumerating_accounts(client, user):
    cache.clear()
    endpoint = reverse("accounts:password_reset")
    rates = _rates("password_reset_request", ip=(10, 60), identity=(1, 60))
    with override_settings(WEB_AUTH_RATE_LIMITS=rates):
        allowed = client.post(
            endpoint,
            {"email": user.email.upper()},
            REMOTE_ADDR="198.51.100.3",
        )
        blocked = client.post(
            endpoint,
            {"email": user.email},
            REMOTE_ADDR="198.51.100.4",
        )

    assert allowed.status_code == 302
    assert blocked.status_code == 429
    assert user.email not in blocked.content.decode()


def test_verification_resend_is_limited_by_normalized_identity(client):
    cache.clear()
    endpoint = reverse("accounts:resend-verification")
    rates = _rates("verification_resend", ip=(10, 60), identity=(1, 60))
    with override_settings(WEB_AUTH_RATE_LIMITS=rates):
        allowed = client.post(
            endpoint,
            {"email": "Pending@Example.cz"},
            REMOTE_ADDR="198.51.100.5",
        )
        blocked = client.post(
            endpoint,
            {"email": "pending@example.cz"},
            REMOTE_ADDR="198.51.100.6",
        )

    assert allowed.status_code == 302
    assert blocked.status_code == 429


def test_password_reset_confirmation_post_is_rate_limited(client, user):
    cache.clear()
    endpoint = reverse(
        "accounts:password_reset_confirm",
        kwargs={
            "uidb64": urlsafe_base64_encode(force_bytes(user.pk)),
            "token": default_token_generator.make_token(user),
        },
    )
    token_redirect = client.get(endpoint)
    assert token_redirect.status_code == 302
    with override_settings(WEB_AUTH_RATE_LIMITS=_rates("password_reset_confirm")):
        allowed = client.post(token_redirect.url, {}, REMOTE_ADDR="198.51.100.7")
        blocked = client.post(token_redirect.url, {}, REMOTE_ADDR="198.51.100.7")

    assert allowed.status_code == 200
    assert blocked.status_code == 429


def test_cache_keys_do_not_contain_raw_ip_or_email(client):
    cache.clear()
    raw_ip = "198.51.100.8"
    raw_email = "private-person@example.cz"
    rates = _rates("password_reset_request", ip=(10, 60), identity=(10, 60))
    with override_settings(WEB_AUTH_RATE_LIMITS=rates):
        client.post(
            reverse("accounts:password_reset"),
            {"email": raw_email},
            REMOTE_ADDR=raw_ip,
        )

    stored_keys = " ".join(cache._cache)
    assert raw_ip not in stored_keys
    assert raw_email not in stored_keys
    assert "web-auth-rate:v1:password_reset_request" in stored_keys


def test_forwarded_address_is_used_only_from_configured_proxy():
    request_factory = RequestFactory()
    untrusted_request = request_factory.post(
        "/",
        REMOTE_ADDR="203.0.113.9",
        HTTP_X_FORWARDED_FOR="198.51.100.10",
    )
    trusted_request = request_factory.post(
        "/",
        REMOTE_ADDR="10.0.0.3",
        HTTP_X_FORWARDED_FOR="192.0.2.20, 198.51.100.10, 10.0.0.2",
    )

    with override_settings(WEB_TRUSTED_PROXY_CIDRS=("10.0.0.0/8",)):
        assert _client_ip(untrusted_request) == "203.0.113.9"
        assert _client_ip(trusted_request) == "198.51.100.10"
