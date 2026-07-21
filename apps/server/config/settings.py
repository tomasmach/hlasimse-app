import ipaddress
import os
import re
from datetime import timedelta
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import dj_database_url
from django.core.exceptions import ImproperlyConfigured, ValidationError
from django.core.validators import validate_email

from core.versioning import InvalidSemVer, parse_semver

BASE_DIR = Path(__file__).resolve().parent.parent


def env_bool(name: str, *, default: bool) -> bool:
    raw_value = os.getenv(name)
    if raw_value is None:
        return default
    normalized = raw_value.strip().lower()
    if normalized not in {"true", "false"}:
        raise ImproperlyConfigured(f"{name} must be either 'true' or 'false'")
    return normalized == "true"


def env_int(name: str, *, default: int, minimum: int, maximum: int) -> int:
    raw_value = os.getenv(name, str(default))
    try:
        value = int(raw_value)
    except ValueError as exc:
        raise ImproperlyConfigured(f"{name} must be an integer") from exc
    if not minimum <= value <= maximum:
        raise ImproperlyConfigured(f"{name} must be between {minimum} and {maximum}")
    return value


DEBUG = env_bool("DJANGO_DEBUG", default=True)


def mobile_release(platform: str) -> dict[str, object]:
    upper_platform = platform.upper()
    version_name = f"MOBILE_MIN_{upper_platform}_VERSION"
    build_name = f"MOBILE_MIN_{upper_platform}_BUILD"
    store_name = f"MOBILE_{upper_platform}_STORE_URL"
    raw_version = os.getenv(version_name)
    raw_build = os.getenv(build_name)
    raw_store_url = os.getenv(store_name)
    if not DEBUG and not raw_version:
        raise ImproperlyConfigured(f"Production requires an explicit {version_name}")
    if not DEBUG and not raw_store_url:
        raise ImproperlyConfigured(f"Production requires an explicit HTTPS {store_name}")
    if not DEBUG and not raw_build:
        raise ImproperlyConfigured(f"Production requires an explicit {build_name}")

    min_version = (raw_version or "1.0.0").strip()
    min_build = (raw_build or "1").strip()
    store_url = (raw_store_url or f"https://example.invalid/dev/{platform}").strip()
    try:
        parsed_min_version = parse_semver(min_version)
    except InvalidSemVer as exc:
        raise ImproperlyConfigured(f"{version_name} must be a valid semantic version") from exc
    if not min_build.isdigit() or int(min_build) <= 0:
        raise ImproperlyConfigured(f"{build_name} must be a positive integer")
    parsed_url = urlsplit(store_url)
    if parsed_url.scheme != "https" or not parsed_url.netloc:
        raise ImproperlyConfigured(f"{store_name} must be an absolute HTTPS URL")
    if not DEBUG:
        if platform == "ios":
            final_path_segment = parsed_url.path.rstrip("/").split("/")[-1]
            valid_store = (
                parsed_url.hostname == "apps.apple.com"
                and "/app/" in parsed_url.path
                and final_path_segment.startswith("id")
                and final_path_segment[2:].isdigit()
            )
        else:
            valid_store = (
                parsed_url.hostname == "play.google.com"
                and parsed_url.path.rstrip("/") == "/store/apps/details"
                and bool(parse_qs(parsed_url.query).get("id", [""])[0])
            )
        if not valid_store:
            raise ImproperlyConfigured(
                f"Production {store_name} must be the final {platform} store listing URL"
            )
    return {
        "min_version": min_version,
        "parsed_min_version": parsed_min_version,
        "min_build": int(min_build),
        "store_url": store_url,
    }


MOBILE_RELEASES = {
    "ios": mobile_release("ios"),
    "android": mobile_release("android"),
}
MOBILE_API_MAINTENANCE = env_bool("MOBILE_API_MAINTENANCE", default=False)
GUARDIAN_LOCATION_DISCLOSURE_ENABLED = env_bool(
    "GUARDIAN_LOCATION_DISCLOSURE_ENABLED", default=True
)
DEADLINE_SWEEPER_ENABLED = env_bool("DEADLINE_SWEEPER_ENABLED", default=True)
ALERT_OUTBOX_ENABLED = env_bool("ALERT_OUTBOX_ENABLED", default=True)
EMAIL_OUTBOX_ENABLED = env_bool("EMAIL_OUTBOX_ENABLED", default=True)
MOBILE_MAINTENANCE_RETRY_AFTER_SECONDS = int(
    os.getenv("MOBILE_MAINTENANCE_RETRY_AFTER_SECONDS", "300")
)
if MOBILE_MAINTENANCE_RETRY_AFTER_SECONDS <= 0:
    raise ImproperlyConfigured("MOBILE_MAINTENANCE_RETRY_AFTER_SECONDS must be positive")

development_secret = "unsafe-development-key-change-me"
SECRET_KEY = os.getenv("DJANGO_SECRET_KEY", development_secret)
if not DEBUG and (
    development_secret == SECRET_KEY
    or len(SECRET_KEY) < 50
    or len(set(SECRET_KEY)) < 12
    or any(
        fragment in SECRET_KEY.casefold()
        for fragment in ("change-me", "placeholder", "replace-with")
    )
):
    raise ImproperlyConfigured(
        "Production requires a high-entropy DJANGO_SECRET_KEY of at least 50 characters"
    )

allowed_hosts_value = os.getenv("DJANGO_ALLOWED_HOSTS", "" if not DEBUG else "localhost,127.0.0.1")
ALLOWED_HOSTS = [host.strip() for host in allowed_hosts_value.split(",") if host.strip()]
if not DEBUG and not ALLOWED_HOSTS:
    raise ImproperlyConfigured("Production requires an explicit DJANGO_ALLOWED_HOSTS")

ADMIN_ENABLED = env_bool("DJANGO_ADMIN_ENABLED", default=DEBUG)
if not DEBUG and ADMIN_ENABLED:
    raise ImproperlyConfigured(
        "The Django admin is disabled in production; use audited management procedures instead"
    )

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "drf_spectacular",
    "rest_framework_simplejwt.token_blacklist",
    "core",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "core.request_logging.CorrelationIdMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "core.middleware.MobileReleaseGateMiddleware",
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
                "core.context_processors.public_support",
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
DATABASE_CONNECT_TIMEOUT_SECONDS = env_int(
    "DATABASE_CONNECT_TIMEOUT_SECONDS", default=5, minimum=1, maximum=30
)
DATABASE_STATEMENT_TIMEOUT_MS = env_int(
    "DATABASE_STATEMENT_TIMEOUT_MS", default=30_000, minimum=1_000, maximum=120_000
)
DATABASE_LOCK_TIMEOUT_MS = env_int(
    "DATABASE_LOCK_TIMEOUT_MS", default=5_000, minimum=100, maximum=30_000
)
DATABASE_IDLE_TRANSACTION_TIMEOUT_MS = env_int(
    "DATABASE_IDLE_TRANSACTION_TIMEOUT_MS", default=15_000, minimum=1_000, maximum=120_000
)
if DATABASE_LOCK_TIMEOUT_MS > DATABASE_STATEMENT_TIMEOUT_MS:
    raise ImproperlyConfigured(
        "DATABASE_LOCK_TIMEOUT_MS must not exceed DATABASE_STATEMENT_TIMEOUT_MS"
    )
if DATABASES["default"]["ENGINE"] == "django.db.backends.postgresql":
    database_options = DATABASES["default"].setdefault("OPTIONS", {})
    database_options["connect_timeout"] = DATABASE_CONNECT_TIMEOUT_SECONDS
    existing_server_options = str(database_options.get("options", "")).strip()
    enforced_server_options = (
        f"-c statement_timeout={DATABASE_STATEMENT_TIMEOUT_MS} "
        f"-c lock_timeout={DATABASE_LOCK_TIMEOUT_MS} "
        f"-c idle_in_transaction_session_timeout={DATABASE_IDLE_TRANSACTION_TIMEOUT_MS}"
    )
    database_options["options"] = " ".join(
        option for option in (existing_server_options, enforced_server_options) if option
    )
if not DEBUG and DATABASES["default"]["ENGINE"] != "django.db.backends.postgresql":
    raise ImproperlyConfigured("Production DATABASE_URL must use PostgreSQL")
DATABASE_ALLOW_INSECURE_LOCAL_COMPOSE = env_bool(
    "DATABASE_ALLOW_INSECURE_LOCAL_COMPOSE", default=False
)
if not DEBUG:
    database_hostname = (urlsplit(database_url or "").hostname or "").casefold()
    if DATABASE_ALLOW_INSECURE_LOCAL_COMPOSE:
        if database_hostname != "postgres":
            raise ImproperlyConfigured(
                "DATABASE_ALLOW_INSECURE_LOCAL_COMPOSE is restricted to the local 'postgres' host"
            )
    else:
        database_options = DATABASES["default"].setdefault("OPTIONS", {})
        ssl_mode = str(database_options.get("sslmode", "require")).casefold()
        if ssl_mode not in {"require", "verify-ca", "verify-full"}:
            raise ImproperlyConfigured(
                "Production PostgreSQL must use sslmode=require, verify-ca, or verify-full"
            )
        database_options["sslmode"] = ssl_mode

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

WEB_TRUSTED_PROXY_CIDRS = tuple(
    value.strip() for value in os.getenv("WEB_TRUSTED_PROXY_CIDRS", "").split(",") if value.strip()
)
try:
    tuple(ipaddress.ip_network(value, strict=False) for value in WEB_TRUSTED_PROXY_CIDRS)
except ValueError as exc:
    raise ImproperlyConfigured("WEB_TRUSTED_PROXY_CIDRS contains an invalid network") from exc
WEB_AUTH_RATE_LIMITS = {
    "login": {"ip": (20, 300), "identity": (8, 300)},
    "registration": {"ip": (10, 3600), "identity": (3, 3600)},
    "password_reset_request": {"ip": (10, 3600), "identity": (3, 3600)},
    "verification_resend": {"ip": (10, 3600), "identity": (3, 3600)},
    "verification_confirm": {"ip": (20, 900)},
    "password_reset_confirm": {"ip": (20, 900), "identity": (10, 900)},
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
        "core.throttling.TrustedProxyAnonRateThrottle",
        "core.throttling.TrustedProxyUserRateThrottle",
    ),
    "DEFAULT_THROTTLE_RATES": {"anon": "20/min", "user": "240/min"},
    "EXCEPTION_HANDLER": "core.exceptions.api_exception_handler",
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
}

SPECTACULAR_SETTINGS = {
    "TITLE": "Hlásím se API",
    "DESCRIPTION": (
        "Versioned mobile API. Server timestamps and incident state are authoritative; "
        "push-provider acceptance is not proof of delivery to a device."
    ),
    "VERSION": "1.0.0",
    "OAS_VERSION": "3.1.0",
    "SERVE_INCLUDE_SCHEMA": False,
    "COMPONENT_SPLIT_REQUEST": True,
    "SORT_OPERATIONS": True,
    "ENUM_NAME_OVERRIDES": {
        "EmailVerificationStatus": (
            "verified",
            "already_verified",
            "invalid",
            "expired",
        ),
        "GuardianInvitationStatus": "core.models.GuardianInvitation.Status",
    },
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
SECURE_REFERRER_POLICY = "same-origin"

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {"json": {"()": "core.request_logging.JsonFormatter"}},
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "json",
        }
    },
    "root": {"handlers": ["console"], "level": "INFO"},
    "loggers": {
        "django.request": {
            "handlers": ["console"],
            "level": "WARNING",
            "propagate": False,
        }
    },
}

EXPO_ACCESS_TOKEN = os.getenv("EXPO_ACCESS_TOKEN", "")
EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"
EXPO_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts"
if not DEBUG and not EXPO_ACCESS_TOKEN:
    raise ImproperlyConfigured(
        "Production requires EXPO_ACCESS_TOKEN and Expo enhanced push security"
    )

raw_legal_terms_version = os.getenv("LEGAL_TERMS_VERSION")
LEGAL_TERMS_VERSION = (raw_legal_terms_version or "development-unpublished").strip()
if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}", LEGAL_TERMS_VERSION):
    raise ImproperlyConfigured(
        "LEGAL_TERMS_VERSION must be a stable 1-64 character identifier using only "
        "letters, numbers, dots, underscores, and hyphens"
    )
if not DEBUG and (
    not raw_legal_terms_version
    or any(
        marker in LEGAL_TERMS_VERSION.casefold()
        for marker in ("draft", "placeholder", "unpublished", "development", "latest")
    )
):
    raise ImproperlyConfigured("Production requires an explicit finalized LEGAL_TERMS_VERSION")

APP_BASE_URL = os.getenv("APP_BASE_URL", "http://localhost:8000").rstrip("/")
try:
    parsed_app_base_url = urlsplit(APP_BASE_URL)
    app_base_port = parsed_app_base_url.port
except ValueError as exc:
    raise ImproperlyConfigured("APP_BASE_URL must be a valid absolute URL") from exc
SUPPORT_EMAIL = os.getenv("SUPPORT_EMAIL", "support@example.invalid").strip().lower()
try:
    validate_email(SUPPORT_EMAIL)
except ValidationError as exc:
    raise ImproperlyConfigured("SUPPORT_EMAIL must be one valid email address") from exc
if not DEBUG:
    support_domain = SUPPORT_EMAIL.rsplit("@", 1)[-1]
    local_compose_support = (
        env_bool("EMAIL_ALLOW_INSECURE_LOCAL_COMPOSE", default=False)
        and APP_BASE_URL == "https://localhost"
        and support_domain == "localhost.invalid"
    )
    if not local_compose_support and (
        not os.getenv("SUPPORT_EMAIL") or support_domain.endswith((".invalid", ".test", ".example"))
    ):
        raise ImproperlyConfigured("Production requires a verified, monitored SUPPORT_EMAIL")
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
EMAIL_ALLOW_INSECURE_LOCAL_COMPOSE = env_bool("EMAIL_ALLOW_INSECURE_LOCAL_COMPOSE", default=False)
EMAIL_TIMEOUT = float(os.getenv("EMAIL_TIMEOUT", "10"))
DEFAULT_FROM_EMAIL = os.getenv("DEFAULT_FROM_EMAIL", "Hlásím se <noreply@hlasim.se>")
SERVER_EMAIL = os.getenv("SERVER_EMAIL", DEFAULT_FROM_EMAIL)

if EMAIL_USE_TLS and EMAIL_USE_SSL:
    raise ImproperlyConfigured("EMAIL_USE_TLS and EMAIL_USE_SSL cannot both be true")
if EMAIL_PORT <= 0 or EMAIL_TIMEOUT <= 0:
    raise ImproperlyConfigured("EMAIL_PORT and EMAIL_TIMEOUT must be positive")
if not DEBUG:
    if (
        parsed_app_base_url.scheme != "https"
        or not parsed_app_base_url.hostname
        or parsed_app_base_url.username
        or parsed_app_base_url.password
        or app_base_port is not None
        or parsed_app_base_url.path
        or parsed_app_base_url.query
        or parsed_app_base_url.fragment
    ):
        raise ImproperlyConfigured(
            "Production APP_BASE_URL must be a clean HTTPS origin without credentials, "
            "port, path, query, or fragment"
        )
    if EMAIL_BACKEND != "django.core.mail.backends.smtp.EmailBackend":
        raise ImproperlyConfigured("Production requires the Django SMTP email backend")
    if EMAIL_ALLOW_INSECURE_LOCAL_COMPOSE:
        if EMAIL_HOST.casefold() != "mailpit" or APP_BASE_URL != "https://localhost":
            raise ImproperlyConfigured(
                "EMAIL_ALLOW_INSECURE_LOCAL_COMPOSE is restricted to local Mailpit"
            )
    elif not EMAIL_USE_TLS and not EMAIL_USE_SSL:
        raise ImproperlyConfigured("Production SMTP must use TLS or SSL")
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
