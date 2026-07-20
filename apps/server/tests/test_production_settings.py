import os
import subprocess
import sys


def production_environment() -> dict[str, str]:
    return {
        **os.environ,
        "DJANGO_DEBUG": "false",
        "DJANGO_SECRET_KEY": "test-only-7BvQ9xLm2Nw4Rc6Ty8Uk1Pa3Sd5Fg7Hj9Kl2Zx4Cv6Bn8Mq",
        "DJANGO_ALLOWED_HOSTS": "app.example.cz",
        "DATABASE_URL": "postgresql://user:password@database.example.cz/hlasimse",
        "APP_BASE_URL": "https://app.example.cz",
        "EXPO_ACCESS_TOKEN": "test-expo-access-token",
        "MOBILE_MIN_IOS_VERSION": "1.0.0",
        "MOBILE_MIN_ANDROID_VERSION": "1.0.0",
        "MOBILE_MIN_IOS_BUILD": "1",
        "MOBILE_MIN_ANDROID_BUILD": "1",
        "MOBILE_IOS_STORE_URL": "https://apps.apple.com/app/id123456789",
        "MOBILE_ANDROID_STORE_URL": "https://play.google.com/store/apps/details?id=cz.example.app",
        "DJANGO_EMAIL_BACKEND": "django.core.mail.backends.smtp.EmailBackend",
        "EMAIL_HOST": "smtp.example.cz",
        "EMAIL_HOST_USER": "user",
        "EMAIL_HOST_PASSWORD": "password",
        "DEFAULT_FROM_EMAIL": "noreply@example.cz",
    }


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
