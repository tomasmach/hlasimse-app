import os
import subprocess
import sys


def production_environment() -> dict[str, str]:
    return {
        **os.environ,
        "DJANGO_DEBUG": "false",
        "DJANGO_SECRET_KEY": "s" * 64,
        "DJANGO_ALLOWED_HOSTS": "app.example.cz",
        "DATABASE_URL": "postgresql://user:password@database.example.cz/hlasimse",
        "APP_BASE_URL": "https://app.example.cz",
        "EXPO_ACCESS_TOKEN": "test-expo-access-token",
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
