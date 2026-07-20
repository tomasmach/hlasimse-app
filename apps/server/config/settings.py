import os
from datetime import timedelta
from pathlib import Path

import dj_database_url
from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent


def env_bool(name: str, *, default: bool) -> bool:
    raw_value = os.getenv(name)
    if raw_value is None:
        return default
    normalized = raw_value.strip().lower()
    if normalized not in {"true", "false"}:
        raise ImproperlyConfigured(f"{name} must be either 'true' or 'false'")
    return normalized == "true"


DEBUG = env_bool("DJANGO_DEBUG", default=True)
development_secret = "unsafe-development-key-change-me"
SECRET_KEY = os.getenv("DJANGO_SECRET_KEY", development_secret)
if not DEBUG and (development_secret == SECRET_KEY or len(SECRET_KEY) < 50):
    raise ImproperlyConfigured(
        "Production requires an explicit DJANGO_SECRET_KEY of at least 50 characters"
    )

allowed_hosts_value = os.getenv("DJANGO_ALLOWED_HOSTS", "" if not DEBUG else "localhost,127.0.0.1")
ALLOWED_HOSTS = [host.strip() for host in allowed_hosts_value.split(",") if host.strip()]
if not DEBUG and not ALLOWED_HOSTS:
    raise ImproperlyConfigured("Production requires an explicit DJANGO_ALLOWED_HOSTS")

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "rest_framework_simplejwt.token_blacklist",
    "core",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]
if not DEBUG:
    MIDDLEWARE.insert(1, "whitenoise.middleware.WhiteNoiseMiddleware")

ROOT_URLCONF = "config.urls"
TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    }
]
WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

default_database_url = f"sqlite:///{BASE_DIR / 'db.sqlite3'}"
database_url = os.getenv("DATABASE_URL")
if not DEBUG and not database_url:
    raise ImproperlyConfigured("Production requires an explicit PostgreSQL DATABASE_URL")
DATABASES = {
    "default": dj_database_url.config(
        default=database_url or default_database_url,
        conn_max_age=60,
        conn_health_checks=True,
    )
}
if not DEBUG and DATABASES["default"]["ENGINE"] != "django.db.backends.postgresql":
    raise ImproperlyConfigured("Production DATABASE_URL must use PostgreSQL")

CACHES = {
    "default": (
        {
            "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
            "LOCATION": "hlasimse-development",
        }
        if DEBUG
        else {
            "BACKEND": "django.core.cache.backends.db.DatabaseCache",
            "LOCATION": "hlasimse_cache",
            "TIMEOUT": 300,
            "OPTIONS": {"MAX_ENTRIES": 100_000, "CULL_FREQUENCY": 10},
        }
    )
}

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "cs"
TIME_ZONE = "Europe/Prague"
USE_I18N = True
USE_TZ = True
STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STATICFILES_DIRS = [BASE_DIR / "static"]
STATIC_MANIFEST = env_bool("DJANGO_STATIC_MANIFEST", default=not DEBUG)
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {
        "BACKEND": (
            "whitenoise.storage.CompressedManifestStaticFilesStorage"
            if STATIC_MANIFEST
            else "django.contrib.staticfiles.storage.StaticFilesStorage"
        )
    },
}
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
AUTH_USER_MODEL = "core.User"
AUTHENTICATION_BACKENDS = ("core.auth_backend.VerifiedEmailBackend",)
LOGIN_URL = "accounts:login"
LOGIN_REDIRECT_URL = "core:dashboard"

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ),
    "DEFAULT_PERMISSION_CLASSES": ("core.permissions.IsVerifiedUser",),
    "DEFAULT_RENDERER_CLASSES": ("rest_framework.renderers.JSONRenderer",),
    "DEFAULT_THROTTLE_CLASSES": (
        "rest_framework.throttling.AnonRateThrottle",
        "rest_framework.throttling.UserRateThrottle",
    ),
    "DEFAULT_THROTTLE_RATES": {"anon": "20/min", "user": "240/min"},
    "EXCEPTION_HANDLER": "core.exceptions.api_exception_handler",
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=15),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=30),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
    "UPDATE_LAST_LOGIN": True,
}

EMAIL_VERIFICATION_TTL = timedelta(hours=24)

SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_SSL_REDIRECT = env_bool("DJANGO_SECURE_SSL_REDIRECT", default=not DEBUG)
SESSION_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_SECURE = not DEBUG
SECURE_HSTS_SECONDS = 31_536_000 if not DEBUG else 0
SECURE_HSTS_INCLUDE_SUBDOMAINS = not DEBUG
SECURE_HSTS_PRELOAD = not DEBUG
X_FRAME_OPTIONS = "DENY"
SECURE_CONTENT_TYPE_NOSNIFF = True

EXPO_ACCESS_TOKEN = os.getenv("EXPO_ACCESS_TOKEN", "")
EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"
EXPO_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts"
if not DEBUG and not EXPO_ACCESS_TOKEN:
    raise ImproperlyConfigured(
        "Production requires EXPO_ACCESS_TOKEN and Expo enhanced push security"
    )

APP_BASE_URL = os.getenv("APP_BASE_URL", "http://localhost:8000").rstrip("/")
EMAIL_BACKEND = os.getenv(
    "DJANGO_EMAIL_BACKEND",
    "django.core.mail.backends.locmem.EmailBackend"
    if DEBUG
    else "django.core.mail.backends.smtp.EmailBackend",
)
EMAIL_HOST = os.getenv("EMAIL_HOST", "")
EMAIL_PORT = int(os.getenv("EMAIL_PORT", "587"))
EMAIL_HOST_USER = os.getenv("EMAIL_HOST_USER", "")
EMAIL_HOST_PASSWORD = os.getenv("EMAIL_HOST_PASSWORD", "")
EMAIL_USE_TLS = env_bool("EMAIL_USE_TLS", default=not DEBUG)
EMAIL_USE_SSL = env_bool("EMAIL_USE_SSL", default=False)
EMAIL_TIMEOUT = float(os.getenv("EMAIL_TIMEOUT", "10"))
DEFAULT_FROM_EMAIL = os.getenv("DEFAULT_FROM_EMAIL", "Hlásím se <noreply@hlasim.se>")
SERVER_EMAIL = os.getenv("SERVER_EMAIL", DEFAULT_FROM_EMAIL)

if EMAIL_USE_TLS and EMAIL_USE_SSL:
    raise ImproperlyConfigured("EMAIL_USE_TLS and EMAIL_USE_SSL cannot both be true")
if EMAIL_PORT <= 0 or EMAIL_TIMEOUT <= 0:
    raise ImproperlyConfigured("EMAIL_PORT and EMAIL_TIMEOUT must be positive")
if not DEBUG:
    if not APP_BASE_URL.startswith("https://"):
        raise ImproperlyConfigured("Production APP_BASE_URL must use HTTPS")
    if EMAIL_BACKEND != "django.core.mail.backends.smtp.EmailBackend":
        raise ImproperlyConfigured("Production requires the Django SMTP email backend")
    required_email_settings = {
        "EMAIL_HOST": EMAIL_HOST,
        "EMAIL_HOST_USER": EMAIL_HOST_USER,
        "EMAIL_HOST_PASSWORD": EMAIL_HOST_PASSWORD,
        "DEFAULT_FROM_EMAIL": os.getenv("DEFAULT_FROM_EMAIL", ""),
    }
    missing_email_settings = sorted(
        name for name, value in required_email_settings.items() if not value
    )
    if missing_email_settings:
        raise ImproperlyConfigured(
            "Production email configuration is incomplete: " + ", ".join(missing_email_settings)
        )
