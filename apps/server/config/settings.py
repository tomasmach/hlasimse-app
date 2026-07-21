import ipaddress
import os
import re
from datetime import timedelta
from email.utils import parseaddr
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import dj_database_url
from django.core.exceptions import ImproperlyConfigured, ValidationError
from django.core.validators import validate_email

from core.legal_documents import LegalDocumentConfigurationError, load_legal_document_set
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

PRODUCTION_PROCESS_ROLES = frozenset(
    {
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
    }
)
SMTP_PROCESS_ROLES = frozenset({"web", "email-outbox", "preflight"})
EXPO_PROCESS_ROLES = frozenset({"alert-outbox", "push-receipts", "preflight"})
raw_process_role = os.getenv("HLASIMSE_PROCESS_ROLE")
HLASIMSE_PROCESS_ROLE = (
    raw_process_role if raw_process_role is not None else ("development" if DEBUG else "")
)
supported_process_roles = PRODUCTION_PROCESS_ROLES | ({"development"} if DEBUG else set())
if HLASIMSE_PROCESS_ROLE not in supported_process_roles:
    supported_values = ", ".join(sorted(supported_process_roles))
    raise ImproperlyConfigured(
        "HLASIMSE_PROCESS_ROLE must be one exact supported role: " + supported_values
    )
PROCESS_REQUIRES_SMTP = HLASIMSE_PROCESS_ROLE in SMTP_PROCESS_ROLES
PROCESS_REQUIRES_EXPO = HLASIMSE_PROCESS_ROLE in EXPO_PROCESS_ROLES


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
ALLOWED_HOSTS = [host.strip().lower() for host in allowed_hosts_value.split(",") if host.strip()]
if not DEBUG and not ALLOWED_HOSTS:
    raise ImproperlyConfigured("Production requires an explicit DJANGO_ALLOWED_HOSTS")
exact_hostname_pattern = re.compile(
    r"(?=.{1,253}\Z)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?"
    r"(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*"
)
invalid_allowed_hosts = []
for allowed_host in ALLOWED_HOSTS:
    if allowed_host.startswith("[") and allowed_host.endswith("]"):
        try:
            ipaddress.IPv6Address(allowed_host[1:-1])
        except ValueError:
            invalid_allowed_hosts.append(allowed_host)
    else:
        try:
            ipaddress.IPv4Address(allowed_host)
        except ValueError:
            if exact_hostname_pattern.fullmatch(allowed_host) is None:
                invalid_allowed_hosts.append(allowed_host)
if not DEBUG and invalid_allowed_hosts:
    raise ImproperlyConfigured(
        "Production DJANGO_ALLOWED_HOSTS must contain only exact valid hostnames or IP addresses"
    )

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
    "core.middleware.ServerTimeHeaderMiddleware",
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
raw_hsts_seconds = os.getenv("DJANGO_HSTS_SECONDS")
if not DEBUG and raw_hsts_seconds is None:
    raise ImproperlyConfigured("Production requires an explicit DJANGO_HSTS_SECONDS")
SECURE_HSTS_SECONDS = env_int(
    "DJANGO_HSTS_SECONDS", default=0 if DEBUG else 3600, minimum=0, maximum=63_072_000
)
SECURE_HSTS_INCLUDE_SUBDOMAINS = env_bool("DJANGO_HSTS_INCLUDE_SUBDOMAINS", default=False)
SECURE_HSTS_PRELOAD = env_bool("DJANGO_HSTS_PRELOAD", default=False)
if not DEBUG and SECURE_HSTS_SECONDS < 300:
    raise ImproperlyConfigured("Production DJANGO_HSTS_SECONDS must be at least 300")
if SECURE_HSTS_INCLUDE_SUBDOMAINS and SECURE_HSTS_SECONDS == 0:
    raise ImproperlyConfigured("HSTS subdomains require a non-zero HSTS duration")
if SECURE_HSTS_PRELOAD and (SECURE_HSTS_SECONDS < 31_536_000 or not SECURE_HSTS_INCLUDE_SUBDOMAINS):
    raise ImproperlyConfigured(
        "HSTS preload requires at least one year and includeSubDomains after a completed domain audit"
    )
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
if not DEBUG and PROCESS_REQUIRES_EXPO and not EXPO_ACCESS_TOKEN:
    raise ImproperlyConfigured(
        f"Production role {HLASIMSE_PROCESS_ROLE} requires EXPO_ACCESS_TOKEN "
        "and Expo enhanced push security"
    )
if not DEBUG and not PROCESS_REQUIRES_EXPO and EXPO_ACCESS_TOKEN:
    raise ImproperlyConfigured(
        f"Production role {HLASIMSE_PROCESS_ROLE} must not receive EXPO_ACCESS_TOKEN"
    )


def legal_version(name: str, *, development_default: str) -> tuple[str | None, str]:
    raw_value = os.getenv(name)
    value = (raw_value or development_default).strip()
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}", value):
        raise ImproperlyConfigured(
            f"{name} must be a stable 1-64 character identifier using only "
            "letters, numbers, dots, underscores, and hyphens"
        )
    if not DEBUG and (
        not raw_value
        or any(
            marker in value.casefold()
            for marker in ("draft", "placeholder", "unpublished", "development", "latest")
        )
    ):
        raise ImproperlyConfigured(f"Production requires an explicit finalized {name}")
    return raw_value, value


raw_legal_terms_version, LEGAL_TERMS_VERSION = legal_version(
    "LEGAL_TERMS_VERSION", development_default="development-unpublished"
)
raw_legal_privacy_version, LEGAL_PRIVACY_VERSION = legal_version(
    "LEGAL_PRIVACY_VERSION", development_default="development-unpublished"
)
LEGAL_TERMS_DOCUMENT_PATH = os.getenv("LEGAL_TERMS_DOCUMENT_PATH", "").strip()
LEGAL_TERMS_DOCUMENT_SHA256 = os.getenv("LEGAL_TERMS_DOCUMENT_SHA256", "").strip().lower()
LEGAL_PRIVACY_DOCUMENT_PATH = os.getenv("LEGAL_PRIVACY_DOCUMENT_PATH", "").strip()
LEGAL_PRIVACY_DOCUMENT_SHA256 = os.getenv("LEGAL_PRIVACY_DOCUMENT_SHA256", "").strip().lower()
try:
    LEGAL_DOCUMENTS = load_legal_document_set(
        privacy_path=LEGAL_PRIVACY_DOCUMENT_PATH,
        privacy_version=LEGAL_PRIVACY_VERSION,
        privacy_sha256=LEGAL_PRIVACY_DOCUMENT_SHA256,
        terms_path=LEGAL_TERMS_DOCUMENT_PATH,
        terms_version=LEGAL_TERMS_VERSION,
        terms_sha256=LEGAL_TERMS_DOCUMENT_SHA256,
    )
except LegalDocumentConfigurationError as exc:
    LEGAL_DOCUMENTS = None
    LEGAL_DOCUMENTS_ERROR = str(exc)
    if not DEBUG:
        raise ImproperlyConfigured(
            "Production requires readable, version-matched and SHA-256-pinned privacy and terms documents"
        ) from exc
else:
    LEGAL_DOCUMENTS_ERROR = ""

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
    (
        "django.core.mail.backends.smtp.EmailBackend"
        if PROCESS_REQUIRES_SMTP
        else "django.core.mail.backends.locmem.EmailBackend"
    ),
)
EMAIL_HOST = os.getenv("EMAIL_HOST", "")
EMAIL_PORT = int(os.getenv("EMAIL_PORT", "587"))
EMAIL_HOST_USER = os.getenv("EMAIL_HOST_USER", "")
EMAIL_HOST_PASSWORD = os.getenv("EMAIL_HOST_PASSWORD", "")
EMAIL_USE_TLS = env_bool("EMAIL_USE_TLS", default=PROCESS_REQUIRES_SMTP and not DEBUG)
EMAIL_USE_SSL = env_bool("EMAIL_USE_SSL", default=False)
EMAIL_ALLOW_INSECURE_LOCAL_COMPOSE = env_bool("EMAIL_ALLOW_INSECURE_LOCAL_COMPOSE", default=False)
EMAIL_TIMEOUT = float(os.getenv("EMAIL_TIMEOUT", "10"))
DEFAULT_FROM_EMAIL = os.getenv("DEFAULT_FROM_EMAIL", "Hlásím se <noreply@hlasim.se>")
SERVER_EMAIL = os.getenv("SERVER_EMAIL", DEFAULT_FROM_EMAIL)
default_from_address = parseaddr(DEFAULT_FROM_EMAIL)[1].strip().lower()
try:
    validate_email(default_from_address)
except ValidationError as exc:
    raise ImproperlyConfigured("DEFAULT_FROM_EMAIL must contain one valid email address") from exc
derived_message_id_domain = default_from_address.rsplit("@", 1)[-1]
EMAIL_MESSAGE_ID_DOMAIN = (
    os.getenv("EMAIL_MESSAGE_ID_DOMAIN", derived_message_id_domain).strip().lower()
)
if (
    len(EMAIL_MESSAGE_ID_DOMAIN) > 253
    or re.fullmatch(
        r"(?=.{1,253}\Z)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+"
        r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?",
        EMAIL_MESSAGE_ID_DOMAIN,
    )
    is None
):
    raise ImproperlyConfigured("EMAIL_MESSAGE_ID_DOMAIN must be a valid DNS domain")

if EMAIL_USE_TLS and EMAIL_USE_SSL:
    raise ImproperlyConfigured("EMAIL_USE_TLS and EMAIL_USE_SSL cannot both be true")
if EMAIL_PORT <= 0 or EMAIL_TIMEOUT <= 0:
    raise ImproperlyConfigured("EMAIL_PORT and EMAIL_TIMEOUT must be positive")
if not DEBUG and (
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
allowed_origin_hostnames = {
    host[1:-1] if host.startswith("[") and host.endswith("]") else host for host in ALLOWED_HOSTS
}
if not DEBUG and parsed_app_base_url.hostname not in allowed_origin_hostnames:
    raise ImproperlyConfigured(
        "Production APP_BASE_URL hostname must be one exact DJANGO_ALLOWED_HOSTS entry"
    )
if not DEBUG and PROCESS_REQUIRES_SMTP:
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
if not DEBUG and not PROCESS_REQUIRES_SMTP:
    unexpected_smtp_credentials = sorted(
        name for name in ("EMAIL_HOST_USER", "EMAIL_HOST_PASSWORD") if os.getenv(name, "").strip()
    )
    if unexpected_smtp_credentials:
        raise ImproperlyConfigured(
            f"Production role {HLASIMSE_PROCESS_ROLE} must not receive SMTP credentials: "
            + ", ".join(unexpected_smtp_credentials)
        )
