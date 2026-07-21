import hashlib
import os
import subprocess
import sys
from pathlib import Path

import pytest

LEGAL_FIXTURE_DIR = Path(__file__).parent / "fixtures" / "legal"
PRODUCTION_PROCESS_ROLES = (
    "web",
    "email-outbox",
    "alert-outbox",
    "push-receipts",
    "preflight",
    "deadline-sweeper",
    "safety-reconciliation",
    "safety-metrics",
    "session-cleanup",
    "delivery-monitor",
    "migration",
)
SMTP_PROCESS_ROLES = {"web", "email-outbox", "preflight"}
EXPO_PROCESS_ROLES = {"alert-outbox", "push-receipts", "preflight"}
SCOPED_PROVIDER_ENVIRONMENT = {
    "EXPO_ACCESS_TOKEN",
    "DJANGO_EMAIL_BACKEND",
    "EMAIL_HOST",
    "EMAIL_PORT",
    "EMAIL_HOST_USER",
    "EMAIL_HOST_PASSWORD",
    "EMAIL_USE_TLS",
    "EMAIL_USE_SSL",
    "EMAIL_ALLOW_INSECURE_LOCAL_COMPOSE",
    "EMAIL_TIMEOUT",
}


def fixture_sha256(name: str) -> str:
    return hashlib.sha256((LEGAL_FIXTURE_DIR / name).read_bytes()).hexdigest()


def production_environment(role: str = "preflight") -> dict[str, str]:
    environment = {**os.environ}
    for name in SCOPED_PROVIDER_ENVIRONMENT | {"HLASIMSE_PROCESS_ROLE"}:
        environment.pop(name, None)
    environment.update(
        {
            "DJANGO_DEBUG": "false",
            "HLASIMSE_PROCESS_ROLE": role,
            "DJANGO_SECRET_KEY": "test-only-7BvQ9xLm2Nw4Rc6Ty8Uk1Pa3Sd5Fg7Hj9Kl2Zx4Cv6Bn8Mq",
            "DJANGO_ALLOWED_HOSTS": "app.example.cz",
            "DJANGO_HSTS_SECONDS": "3600",
            "DJANGO_HSTS_INCLUDE_SUBDOMAINS": "false",
            "DJANGO_HSTS_PRELOAD": "false",
            "DATABASE_URL": "postgresql://user:password@database.example.cz/hlasimse",
            "APP_BASE_URL": "https://app.example.cz",
            "SUPPORT_EMAIL": "support@app.example.cz",
            "LEGAL_PRIVACY_VERSION": "test-privacy-v1",
            "LEGAL_PRIVACY_DOCUMENT_PATH": str(LEGAL_FIXTURE_DIR / "privacy.json"),
            "LEGAL_PRIVACY_DOCUMENT_SHA256": fixture_sha256("privacy.json"),
            "LEGAL_TERMS_VERSION": "test-terms-v1",
            "LEGAL_TERMS_DOCUMENT_PATH": str(LEGAL_FIXTURE_DIR / "terms.json"),
            "LEGAL_TERMS_DOCUMENT_SHA256": fixture_sha256("terms.json"),
            "MOBILE_MIN_IOS_VERSION": "1.0.0",
            "MOBILE_MIN_ANDROID_VERSION": "1.0.0",
            "MOBILE_MIN_IOS_BUILD": "1",
            "MOBILE_MIN_ANDROID_BUILD": "1",
            "MOBILE_IOS_STORE_URL": "https://apps.apple.com/app/id123456789",
            "MOBILE_ANDROID_STORE_URL": "https://play.google.com/store/apps/details?id=cz.example.app",
            "DEFAULT_FROM_EMAIL": "noreply@example.cz",
        }
    )
    if role in EXPO_PROCESS_ROLES:
        environment["EXPO_ACCESS_TOKEN"] = "test-expo-access-token"
    if role in SMTP_PROCESS_ROLES:
        environment.update(
            {
                "DJANGO_EMAIL_BACKEND": "django.core.mail.backends.smtp.EmailBackend",
                "EMAIL_HOST": "smtp.example.cz",
                "EMAIL_HOST_USER": "user",
                "EMAIL_HOST_PASSWORD": "password",
            }
        )
    return environment


@pytest.mark.parametrize("role", PRODUCTION_PROCESS_ROLES)
def test_production_accepts_exact_supported_process_roles_with_scoped_secrets(role):
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            (
                "from config.settings import HLASIMSE_PROCESS_ROLE; "
                f"assert HLASIMSE_PROCESS_ROLE == {role!r}"
            ),
        ],
        capture_output=True,
        check=False,
        env=production_environment(role),
        text=True,
    )

    assert result.returncode == 0, result.stderr


@pytest.mark.parametrize("role", (None, "", "development", "web ", "unknown"))
def test_production_requires_exact_supported_process_role(role):
    environment = production_environment()
    if role is None:
        environment.pop("HLASIMSE_PROCESS_ROLE")
    else:
        environment["HLASIMSE_PROCESS_ROLE"] = role

    result = subprocess.run(
        [sys.executable, "-c", "import config.settings"],
        capture_output=True,
        check=False,
        env=environment,
        text=True,
    )

    assert result.returncode != 0
    assert "HLASIMSE_PROCESS_ROLE" in result.stderr


def test_debug_defaults_to_development_process_role():
    environment = {**os.environ, "DJANGO_DEBUG": "true"}
    environment.pop("HLASIMSE_PROCESS_ROLE", None)
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            (
                "from config.settings import HLASIMSE_PROCESS_ROLE; "
                "assert HLASIMSE_PROCESS_ROLE == 'development'"
            ),
        ],
        capture_output=True,
        check=False,
        env=environment,
        text=True,
    )

    assert result.returncode == 0, result.stderr


@pytest.mark.parametrize("role", sorted(EXPO_PROCESS_ROLES))
def test_expo_roles_require_their_access_token(role):
    environment = production_environment(role)
    environment.pop("EXPO_ACCESS_TOKEN")
    result = subprocess.run(
        [sys.executable, "-c", "import config.settings"],
        capture_output=True,
        check=False,
        env=environment,
        text=True,
    )

    assert result.returncode != 0
    assert "EXPO_ACCESS_TOKEN" in result.stderr


@pytest.mark.parametrize("role", sorted(set(PRODUCTION_PROCESS_ROLES) - EXPO_PROCESS_ROLES))
def test_non_expo_roles_reject_expo_access_token(role):
    environment = production_environment(role)
    environment["EXPO_ACCESS_TOKEN"] = "overprivileged-token"
    result = subprocess.run(
        [sys.executable, "-c", "import config.settings"],
        capture_output=True,
        check=False,
        env=environment,
        text=True,
    )

    assert result.returncode != 0
    assert "must not receive EXPO_ACCESS_TOKEN" in result.stderr


@pytest.mark.parametrize("role", sorted(SMTP_PROCESS_ROLES))
def test_smtp_roles_require_their_password(role):
    environment = production_environment(role)
    environment.pop("EMAIL_HOST_PASSWORD")
    result = subprocess.run(
        [sys.executable, "-c", "import config.settings"],
        capture_output=True,
        check=False,
        env=environment,
        text=True,
    )

    assert result.returncode != 0
    assert "EMAIL_HOST_PASSWORD" in result.stderr


@pytest.mark.parametrize("role", sorted(set(PRODUCTION_PROCESS_ROLES) - SMTP_PROCESS_ROLES))
def test_non_smtp_roles_reject_smtp_credentials(role):
    environment = production_environment(role)
    environment["EMAIL_HOST_PASSWORD"] = "overprivileged-password"
    result = subprocess.run(
        [sys.executable, "-c", "import config.settings"],
        capture_output=True,
        check=False,
        env=environment,
        text=True,
    )

    assert result.returncode != 0
    assert "must not receive SMTP credentials" in result.stderr


def test_production_uses_shared_database_cache():
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            (
                "from config.settings import CACHES; "
                "assert CACHES['default']['BACKEND'] == "
                "'django.core.cache.backends.db.DatabaseCache'; "
                "assert CACHES['default']['LOCATION'] == 'hlasimse_cache'"
            ),
        ],
        capture_output=True,
        check=False,
        env=production_environment(),
        text=True,
    )

    assert result.returncode == 0, result.stderr


def test_production_requires_expo_enhanced_push_security_token():
    environment = production_environment()
    environment.pop("EXPO_ACCESS_TOKEN")

    result = subprocess.run(
        [sys.executable, "-c", "import config.settings"],
        capture_output=True,
        check=False,
        env=environment,
        text=True,
    )

    assert result.returncode != 0
    assert "Expo enhanced push security" in result.stderr


def test_production_requires_verified_support_email():
    for value in (None, "not-an-email", "support@example.invalid"):
        environment = production_environment()
        if value is None:
            environment.pop("SUPPORT_EMAIL")
        else:
            environment["SUPPORT_EMAIL"] = value

        result = subprocess.run(
            [sys.executable, "-c", "import config.settings"],
            capture_output=True,
            check=False,
            env=environment,
            text=True,
        )

        assert result.returncode != 0
        assert "SUPPORT_EMAIL" in result.stderr


def test_message_id_domain_defaults_to_verified_sender_domain():
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            (
                "from config.settings import EMAIL_MESSAGE_ID_DOMAIN; "
                "assert EMAIL_MESSAGE_ID_DOMAIN == 'example.cz'"
            ),
        ],
        capture_output=True,
        check=False,
        env=production_environment(),
        text=True,
    )

    assert result.returncode == 0, result.stderr


def test_production_rejects_invalid_message_id_domain():
    result = subprocess.run(
        [sys.executable, "-c", "import config.settings"],
        capture_output=True,
        check=False,
        env={**production_environment(), "EMAIL_MESSAGE_ID_DOMAIN": "invalid domain"},
        text=True,
    )

    assert result.returncode != 0
    assert "EMAIL_MESSAGE_ID_DOMAIN" in result.stderr


def test_production_requires_clean_https_app_origin():
    for value in (
        "http://app.example.cz",
        "https://user:secret@app.example.cz",
        "https://app.example.cz:8443",
        "https://app.example.cz/api",
        "https://app.example.cz?source=mobile",
        "https://app.example.cz#legal",
    ):
        environment = production_environment()
        environment["APP_BASE_URL"] = value

        result = subprocess.run(
            [sys.executable, "-c", "import config.settings"],
            capture_output=True,
            check=False,
            env=environment,
            text=True,
        )

        assert result.returncode != 0, value
        assert "APP_BASE_URL" in result.stderr


@pytest.mark.parametrize(
    "value",
    [
        "*",
        ".example.cz",
        "*.example.cz",
        "10.0.0.0/8",
        "app.example.cz:443",
        "app example.cz",
        "-app.example.cz",
        "app..example.cz",
    ],
)
def test_production_rejects_broad_allowed_hosts(value):
    result = subprocess.run(
        [sys.executable, "-c", "import config.settings"],
        capture_output=True,
        check=False,
        env={**production_environment(), "DJANGO_ALLOWED_HOSTS": value},
        text=True,
    )
    assert result.returncode != 0
    assert "DJANGO_ALLOWED_HOSTS" in result.stderr


def test_production_requires_canonical_origin_in_allowed_hosts():
    result = subprocess.run(
        [sys.executable, "-c", "import config.settings"],
        capture_output=True,
        check=False,
        env={**production_environment(), "DJANGO_ALLOWED_HOSTS": "other.example.cz"},
        text=True,
    )
    assert result.returncode != 0
    assert "APP_BASE_URL hostname" in result.stderr


def test_production_accepts_matching_bracketed_ipv6_origin():
    environment = production_environment()
    environment.update(
        {
            "DJANGO_ALLOWED_HOSTS": "[2001:db8::1]",
            "APP_BASE_URL": "https://[2001:db8::1]",
        }
    )
    result = subprocess.run(
        [sys.executable, "-c", "import config.settings"],
        capture_output=True,
        check=False,
        env=environment,
        text=True,
    )

    assert result.returncode == 0, result.stderr


def test_production_requires_explicit_staged_hsts_policy():
    environment = production_environment()
    environment.pop("DJANGO_HSTS_SECONDS")
    result = subprocess.run(
        [sys.executable, "-c", "import config.settings"],
        capture_output=True,
        check=False,
        env=environment,
        text=True,
    )
    assert result.returncode != 0
    assert "DJANGO_HSTS_SECONDS" in result.stderr


def test_hsts_preload_requires_audited_one_year_subdomain_policy():
    unsafe = production_environment()
    unsafe.update({"DJANGO_HSTS_PRELOAD": "true", "DJANGO_HSTS_SECONDS": "3600"})
    failed = subprocess.run(
        [sys.executable, "-c", "import config.settings"],
        capture_output=True,
        check=False,
        env=unsafe,
        text=True,
    )
    assert failed.returncode != 0
    assert "HSTS preload" in failed.stderr

    audited = production_environment()
    audited.update(
        {
            "DJANGO_HSTS_PRELOAD": "true",
            "DJANGO_HSTS_INCLUDE_SUBDOMAINS": "true",
            "DJANGO_HSTS_SECONDS": "31536000",
        }
    )
    passed = subprocess.run(
        [sys.executable, "-c", "import config.settings"],
        capture_output=True,
        check=False,
        env=audited,
        text=True,
    )
    assert passed.returncode == 0, passed.stderr


def test_production_requires_explicit_finalized_terms_version():
    for value in (None, "", "latest", "draft-v2", "contains spaces", "x" * 65):
        environment = production_environment()
        if value is None:
            environment.pop("LEGAL_TERMS_VERSION")
        else:
            environment["LEGAL_TERMS_VERSION"] = value

        result = subprocess.run(
            [sys.executable, "-c", "import config.settings"],
            capture_output=True,
            check=False,
            env=environment,
            text=True,
        )

        assert result.returncode != 0, value
        assert "LEGAL_TERMS_VERSION" in result.stderr


@pytest.mark.parametrize(
    "name",
    [
        "LEGAL_PRIVACY_VERSION",
        "LEGAL_PRIVACY_DOCUMENT_PATH",
        "LEGAL_PRIVACY_DOCUMENT_SHA256",
        "LEGAL_TERMS_DOCUMENT_PATH",
        "LEGAL_TERMS_DOCUMENT_SHA256",
    ],
)
def test_production_requires_immutable_legal_document_configuration(name):
    environment = production_environment()
    environment.pop(name)

    result = subprocess.run(
        [sys.executable, "-c", "import config.settings"],
        capture_output=True,
        check=False,
        env=environment,
        text=True,
    )

    assert result.returncode != 0
    assert "LEGAL_" in result.stderr or "privacy and terms documents" in result.stderr


@pytest.mark.parametrize(
    ("name", "value"),
    [
        ("LEGAL_TERMS_DOCUMENT_SHA256", "0" * 64),
        ("LEGAL_PRIVACY_DOCUMENT_SHA256", "0" * 64),
        ("LEGAL_PRIVACY_VERSION", "wrong-version"),
        ("LEGAL_TERMS_VERSION", "wrong-version"),
    ],
)
def test_production_rejects_legal_document_hash_or_version_drift(name, value):
    environment = production_environment()
    environment[name] = value

    result = subprocess.run(
        [sys.executable, "-c", "import config.settings"],
        capture_output=True,
        check=False,
        env=environment,
        text=True,
    )

    assert result.returncode != 0
    assert "privacy and terms documents" in result.stderr


def test_guardian_location_disclosure_switch_defaults_enabled_and_rejects_invalid_value():
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            (
                "from config.settings import GUARDIAN_LOCATION_DISCLOSURE_ENABLED; "
                "assert GUARDIAN_LOCATION_DISCLOSURE_ENABLED is True"
            ),
        ],
        capture_output=True,
        check=False,
        env=production_environment(),
        text=True,
    )
    assert result.returncode == 0, result.stderr

    invalid_environment = {
        **production_environment(),
        "GUARDIAN_LOCATION_DISCLOSURE_ENABLED": "paused",
    }
    result = subprocess.run(
        [sys.executable, "-c", "import config.settings"],
        capture_output=True,
        check=False,
        env=invalid_environment,
        text=True,
    )
    assert result.returncode != 0
    assert "GUARDIAN_LOCATION_DISCLOSURE_ENABLED" in result.stderr


def test_production_requires_explicit_mobile_release_configuration():
    for name in (
        "MOBILE_MIN_IOS_VERSION",
        "MOBILE_MIN_ANDROID_VERSION",
        "MOBILE_MIN_IOS_BUILD",
        "MOBILE_MIN_ANDROID_BUILD",
        "MOBILE_IOS_STORE_URL",
        "MOBILE_ANDROID_STORE_URL",
    ):
        environment = production_environment()
        environment.pop(name)

        result = subprocess.run(
            [sys.executable, "-c", "import config.settings"],
            capture_output=True,
            check=False,
            env=environment,
            text=True,
        )

        assert result.returncode != 0
        assert name in result.stderr


def test_production_rejects_invalid_version_and_unsafe_store_url():
    cases = {
        "MOBILE_MIN_IOS_VERSION": "1.0",
        "MOBILE_MIN_ANDROID_BUILD": "0",
        "MOBILE_ANDROID_STORE_URL": "http://play.example.cz/app",
        "MOBILE_IOS_STORE_URL": "https://apps.apple.com/not-an-app-listing",
    }
    for name, value in cases.items():
        environment = production_environment()
        environment[name] = value

        result = subprocess.run(
            [sys.executable, "-c", "import config.settings"],
            capture_output=True,
            check=False,
            env=environment,
            text=True,
        )

        assert result.returncode != 0
        assert name in result.stderr


def test_production_requires_encrypted_postgresql_and_preserves_stronger_mode():
    environment = production_environment()
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            "from config.settings import DATABASES; "
            "assert DATABASES['default']['OPTIONS']['sslmode'] == 'require'",
        ],
        capture_output=True,
        check=False,
        env=environment,
        text=True,
    )
    assert result.returncode == 0, result.stderr

    environment["DATABASE_URL"] += "?sslmode=verify-full"
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            "from config.settings import DATABASES; "
            "assert DATABASES['default']['OPTIONS']['sslmode'] == 'verify-full'",
        ],
        capture_output=True,
        check=False,
        env=environment,
        text=True,
    )
    assert result.returncode == 0, result.stderr


def test_postgresql_connections_enforce_bounded_operation_timeouts():
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            (
                "from config.settings import DATABASES; "
                "options = DATABASES['default']['OPTIONS']; "
                "assert options['connect_timeout'] == 5; "
                "assert '-c statement_timeout=30000' in options['options']; "
                "assert '-c lock_timeout=5000' in options['options']; "
                "assert '-c idle_in_transaction_session_timeout=15000' in options['options']"
            ),
        ],
        capture_output=True,
        check=False,
        env=production_environment(),
        text=True,
    )

    assert result.returncode == 0, result.stderr


def test_production_rejects_unsafe_database_timeout_configuration():
    for overrides in (
        {"DATABASE_CONNECT_TIMEOUT_SECONDS": "0"},
        {"DATABASE_STATEMENT_TIMEOUT_MS": "none"},
        {"DATABASE_STATEMENT_TIMEOUT_MS": "500"},
        {"DATABASE_LOCK_TIMEOUT_MS": "31000"},
        {
            "DATABASE_STATEMENT_TIMEOUT_MS": "1000",
            "DATABASE_LOCK_TIMEOUT_MS": "2000",
        },
        {"DATABASE_IDLE_TRANSACTION_TIMEOUT_MS": "121000"},
    ):
        result = subprocess.run(
            [sys.executable, "-c", "import config.settings"],
            capture_output=True,
            check=False,
            env={**production_environment(), **overrides},
            text=True,
        )
        assert result.returncode != 0, overrides


def test_production_rejects_insecure_remote_database_and_smtp():
    cases = (
        {"DATABASE_URL": "postgresql://user:password@database.example.cz/hlasimse?sslmode=disable"},
        {"EMAIL_USE_TLS": "false", "EMAIL_USE_SSL": "false"},
        {
            "DATABASE_ALLOW_INSECURE_LOCAL_COMPOSE": "true",
            "DATABASE_URL": "postgresql://user:password@database.example.cz/hlasimse",
        },
        {
            "EMAIL_ALLOW_INSECURE_LOCAL_COMPOSE": "true",
            "EMAIL_USE_TLS": "false",
            "EMAIL_HOST": "smtp.example.cz",
        },
    )
    for overrides in cases:
        environment = {**production_environment(), **overrides}
        result = subprocess.run(
            [sys.executable, "-c", "import config.settings"],
            capture_output=True,
            check=False,
            env=environment,
            text=True,
        )
        assert result.returncode != 0, overrides


def test_local_compose_exceptions_are_narrow_and_explicit():
    environment = {
        **production_environment(),
        "DATABASE_URL": "postgresql://user:password@postgres:5432/hlasimse",
        "DATABASE_ALLOW_INSECURE_LOCAL_COMPOSE": "true",
        "APP_BASE_URL": "https://localhost",
        "DJANGO_ALLOWED_HOSTS": "localhost",
        "EMAIL_HOST": "mailpit",
        "EMAIL_USE_TLS": "false",
        "EMAIL_USE_SSL": "false",
        "EMAIL_ALLOW_INSECURE_LOCAL_COMPOSE": "true",
    }
    result = subprocess.run(
        [sys.executable, "-c", "import config.settings"],
        capture_output=True,
        check=False,
        env=environment,
        text=True,
    )
    assert result.returncode == 0, result.stderr


def test_production_disables_admin_and_rejects_weak_secrets():
    environment = production_environment()
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            "from config.settings import ADMIN_ENABLED; assert ADMIN_ENABLED is False",
        ],
        capture_output=True,
        check=False,
        env=environment,
        text=True,
    )
    assert result.returncode == 0, result.stderr

    for overrides in (
        {"DJANGO_ADMIN_ENABLED": "true"},
        {"DJANGO_SECRET_KEY": "s" * 64},
        {"DJANGO_SECRET_KEY": "replace-with-a-production-secret-key-that-is-long-enough"},
        {"WEB_TRUSTED_PROXY_CIDRS": "not-a-network"},
    ):
        result = subprocess.run(
            [sys.executable, "-c", "import config.settings"],
            capture_output=True,
            check=False,
            env={**production_environment(), **overrides},
            text=True,
        )
        assert result.returncode != 0, overrides
