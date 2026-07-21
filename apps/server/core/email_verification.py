import hashlib
import uuid
from dataclasses import dataclass

from django.conf import settings
from django.core import signing
from django.core.cache import cache
from django.db import IntegrityError, transaction
from django.urls import reverse
from django.utils import timezone

from .audit import record_audit_event
from .legal_documents import require_configured_legal_documents
from .models import EmailVerificationChallenge, OutboxEvent, User

SIGNING_SALT = "hlasimse.email-verification.v1"
RESEND_COOLDOWN_SECONDS = 60
GENERIC_SENT_MESSAGE = "Pokud lze adresu použít, poslali jsme na ni odkaz k ověření."


@dataclass(frozen=True)
class VerificationResult:
    status: str
    user: User | None = None


def normalize_email(email: str) -> str:
    return User.objects.normalize_email(email).strip().lower()


def verification_token(challenge: EmailVerificationChallenge) -> str:
    signer = signing.Signer(key=settings.SECRET_KEY, salt=SIGNING_SALT)
    return signer.sign_object({"challenge_id": str(challenge.id)}, compress=True)


def verification_url(challenge: EmailVerificationChallenge) -> str:
    path = reverse("accounts:verify-email", kwargs={"token": verification_token(challenge)})
    return f"{settings.APP_BASE_URL.rstrip('/')}{path}"


def _active_challenge(user: User) -> EmailVerificationChallenge | None:
    return (
        EmailVerificationChallenge.objects.select_for_update()
        .filter(user=user, used_at__isnull=True, cancelled_at__isnull=True)
        .first()
    )


def _issue_challenge_locked(
    *,
    user: User,
    actor: User | None = None,
    replace_after_seconds: int | None = None,
) -> tuple[EmailVerificationChallenge, bool]:
    now = timezone.now()
    active = _active_challenge(user)
    if active is not None and active.expires_at > now:
        if replace_after_seconds is None:
            return active, False
        age = (now - active.last_delivery_requested_at).total_seconds()
        if age < replace_after_seconds:
            return active, False
        active.last_delivery_requested_at = now
        active.save(update_fields=["last_delivery_requested_at", "updated_at"])
        _enqueue_verification_email(challenge=active)
        record_audit_event(
            event_type="user.email_verification_requested",
            aggregate_type="user",
            aggregate_id=user.id,
            actor=actor,
        )
        return active, True
    EmailVerificationChallenge.objects.filter(
        user=user,
        used_at__isnull=True,
        cancelled_at__isnull=True,
    ).update(cancelled_at=now, updated_at=now)
    challenge = EmailVerificationChallenge.objects.create(
        user=user,
        expires_at=now + settings.EMAIL_VERIFICATION_TTL,
        last_delivery_requested_at=now,
    )

    _enqueue_verification_email(challenge=challenge)
    record_audit_event(
        event_type="user.email_verification_requested",
        aggregate_type="user",
        aggregate_id=user.id,
        actor=actor,
    )
    return challenge, True


def _enqueue_verification_email(*, challenge: EmailVerificationChallenge) -> OutboxEvent:
    event_id = uuid.uuid4()
    return OutboxEvent.objects.create(
        id=event_id,
        event_type="user.email_verification",
        aggregate_type="email_verification",
        aggregate_id=challenge.id,
        deduplication_key=f"email-verification:{challenge.id}:delivery:{event_id}",
        payload={"challenge_id": str(challenge.id)},
    )


def register_unverified_user(
    *,
    email: str,
    password: str,
    terms_accepted: bool,
    first_name: str = "",
    last_name: str = "",
) -> tuple[User, bool]:
    """Create an unverified user or safely replay registration without enumeration."""
    legal_documents = require_configured_legal_documents()
    if terms_accepted is not True:
        raise ValueError("Registration requires explicit acceptance of the current terms.")
    normalized = normalize_email(email)
    with transaction.atomic():
        user = User.objects.select_for_update().filter(email__iexact=normalized).first()
        created = False
        if user is None:
            try:
                with transaction.atomic():
                    user = User.objects.create_user(
                        email=normalized,
                        password=password,
                        first_name=first_name.strip(),
                        last_name=last_name.strip(),
                        email_verified_at=None,
                        terms_accepted_at=timezone.now(),
                        terms_version=legal_documents.terms.version,
                    )
                    created = True
            except IntegrityError:
                user = User.objects.select_for_update().get(email__iexact=normalized)
        if user.email_verified_at is None and user.is_active:
            _issue_challenge_locked(user=user, actor=user if created else None)
        return user, created


def resend_verification(*, email: str) -> bool:
    """Resend the active one-time link, creating a challenge only after expiry."""
    normalized = normalize_email(email)
    digest = hashlib.sha256(normalized.encode("utf-8")).hexdigest()
    cache_key = f"email-verification-resend:{digest}"
    if not cache.add(cache_key, "1", timeout=RESEND_COOLDOWN_SECONDS):
        return False
    with transaction.atomic():
        user = (
            User.objects.select_for_update()
            .filter(email__iexact=normalized, is_active=True, email_verified_at__isnull=True)
            .first()
        )
        if user is not None:
            _issue_challenge_locked(
                user=user,
                replace_after_seconds=RESEND_COOLDOWN_SECONDS,
            )
    return True


def verify_signed_token(token: str) -> VerificationResult:
    try:
        signer = signing.Signer(key=settings.SECRET_KEY, salt=SIGNING_SALT)
        signed_data = signer.unsign_object(token)
        challenge_id = signed_data["challenge_id"]
    except signing.BadSignature, KeyError, TypeError, ValueError:
        return VerificationResult("invalid")

    with transaction.atomic():
        challenge = (
            EmailVerificationChallenge.objects.select_for_update()
            .select_related("user")
            .filter(pk=challenge_id)
            .first()
        )
        if challenge is None:
            return VerificationResult("invalid")
        user = User.objects.select_for_update().filter(pk=challenge.user_id).first()
        if user is None or not user.is_active:
            return VerificationResult("invalid")
        if challenge.used_at is not None and user.email_verified_at is not None:
            return VerificationResult("already_verified", user)
        if user.email_verified_at is not None:
            return VerificationResult("already_verified", user)
        if challenge.cancelled_at is not None:
            return VerificationResult("invalid")
        now = timezone.now()
        if challenge.expires_at <= now:
            challenge.cancelled_at = now
            challenge.save(update_fields=["cancelled_at", "updated_at"])
            return VerificationResult("expired", user)

        user.email_verified_at = now
        user.save(update_fields=["email_verified_at"])
        challenge.used_at = now
        challenge.save(update_fields=["used_at", "updated_at"])
        EmailVerificationChallenge.objects.filter(
            user=user,
            used_at__isnull=True,
            cancelled_at__isnull=True,
        ).exclude(pk=challenge.pk).update(cancelled_at=now, updated_at=now)
        record_audit_event(
            event_type="user.email_verified",
            aggregate_type="user",
            aggregate_id=user.id,
            actor=user,
        )
        return VerificationResult("verified", user)
