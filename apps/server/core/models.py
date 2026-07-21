import uuid
from datetime import timedelta

from django.conf import settings
from django.contrib.auth.base_user import AbstractBaseUser
from django.contrib.auth.models import PermissionsMixin
from django.core.exceptions import ValidationError
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.db.models import Q
from django.db.models.functions import Lower, Mod
from django.db.models.lookups import Exact
from django.utils import timezone

from .managers import UserManager

MIN_INTERVAL_SECONDS = 3_600
MAX_INTERVAL_SECONDS = 7 * 24 * 60 * 60
MAX_CUSTOM_PAUSE_HORIZON = timedelta(days=366)
PAUSED_UNTIL_MAX_ERROR = (
    "Automatické obnovení lze naplánovat nejvýše 366 dní od aktuálního serverového času."
)


def validate_whole_minutes(value: int) -> None:
    if value % 60:
        raise ValidationError("Interval musí být zadaný v celých minutách.")


def validate_paused_until_horizon(paused_until, *, now=None) -> None:
    if paused_until is None:
        return
    server_now = now or timezone.now()
    if paused_until > server_now + MAX_CUSTOM_PAUSE_HORIZON:
        raise ValidationError({"paused_until": PAUSED_UNTIL_MAX_ERROR})


class UUIDModel(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class ImmutableAuditEventQuerySet(models.QuerySet):
    def update(self, **kwargs):
        raise TypeError("Audit events are immutable.")

    def delete(self):
        raise TypeError("Audit events are immutable.")


class User(AbstractBaseUser, PermissionsMixin):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.EmailField(unique=True)
    first_name = models.CharField(max_length=150, blank=True)
    last_name = models.CharField(max_length=150, blank=True)
    is_staff = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    date_joined = models.DateTimeField(default=timezone.now)
    email_verified_at = models.DateTimeField(null=True, blank=True)
    terms_accepted_at = models.DateTimeField(null=True, blank=True, editable=False)
    terms_version = models.CharField(max_length=64, blank=True, editable=False)

    objects = UserManager()

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS: list[str] = []

    class Meta:
        constraints = [
            models.UniqueConstraint(
                Lower("email"),
                name="unique_user_email_case_insensitive",
            ),
            models.CheckConstraint(
                condition=(Q(terms_accepted_at__isnull=True) & Q(terms_version=""))
                | (Q(terms_accepted_at__isnull=False) & ~Q(terms_version="")),
                name="user_terms_acceptance_pair",
            ),
        ]

    def __str__(self) -> str:
        return self.email

    @property
    def is_email_verified(self) -> bool:
        return self.email_verified_at is not None


class EmailVerificationChallenge(UUIDModel):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="email_verification_challenges",
    )
    expires_at = models.DateTimeField(db_index=True)
    last_delivery_requested_at = models.DateTimeField(default=timezone.now)
    used_at = models.DateTimeField(null=True, blank=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["user"],
                condition=Q(used_at__isnull=True, cancelled_at__isnull=True),
                name="unique_active_email_verification",
            ),
        ]

    def __str__(self) -> str:
        return f"Verification challenge {self.id}"

    @property
    def is_pending(self) -> bool:
        return (
            self.used_at is None and self.cancelled_at is None and self.expires_at > timezone.now()
        )


class CheckInProfile(UUIDModel):
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="profiles"
    )
    name = models.CharField(max_length=120)
    interval_seconds = models.PositiveIntegerField(
        default=86_400,
        validators=[
            MinValueValidator(MIN_INTERVAL_SECONDS),
            MaxValueValidator(MAX_INTERVAL_SECONDS),
            validate_whole_minutes,
        ],
    )
    enabled = models.BooleanField(default=True)
    is_paused = models.BooleanField(default=False)
    paused_until = models.DateTimeField(null=True, blank=True)
    last_checked_in_at = models.DateTimeField(null=True, blank=True)
    next_deadline_at = models.DateTimeField(null=True, blank=True, db_index=True)
    deadline_generation = models.PositiveBigIntegerField(default=0)
    archived_at = models.DateTimeField(null=True, blank=True, db_index=True)

    class Meta:
        ordering = ["created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["owner", "name"],
                condition=Q(archived_at__isnull=True),
                name="unique_active_profile_name_per_owner",
            ),
            models.CheckConstraint(
                condition=Q(interval_seconds__gte=MIN_INTERVAL_SECONDS)
                & Q(interval_seconds__lte=MAX_INTERVAL_SECONDS)
                & Exact(Mod("interval_seconds", 60), 0),
                name="profile_interval_whole_minutes_1h_7d",
            ),
            models.CheckConstraint(
                condition=Q(is_paused=True) | Q(paused_until__isnull=True),
                name="profile_pause_until_requires_pause",
            ),
            models.CheckConstraint(
                condition=Q(archived_at__isnull=True)
                | (
                    Q(enabled=False)
                    & Q(is_paused=True)
                    & Q(paused_until__isnull=True)
                    & Q(next_deadline_at__isnull=True)
                ),
                name="archived_profile_is_inert",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.owner_id}: {self.name}"

    def clean(self):
        super().clean()
        validate_paused_until_horizon(self.paused_until)


class CheckIn(UUIDModel):
    profile = models.ForeignKey(CheckInProfile, on_delete=models.CASCADE, related_name="check_ins")
    idempotency_key = models.CharField(max_length=128)
    accepted_at = models.DateTimeField(default=timezone.now)
    client_recorded_at = models.DateTimeField(null=True, blank=True)
    latitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    longitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    location_accuracy_meters = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        null=True,
        blank=True,
        validators=[MinValueValidator(0), MaxValueValidator(1_000_000)],
    )
    deadline_generation = models.PositiveBigIntegerField()
    response_deadline_at = models.DateTimeField(null=True, blank=True)
    submitted_from_queue = models.BooleanField(default=False)

    class Meta:
        ordering = ["-accepted_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["profile", "idempotency_key"], name="unique_checkin_idempotency"
            ),
            models.CheckConstraint(
                condition=(Q(latitude__isnull=True) & Q(longitude__isnull=True))
                | (Q(latitude__isnull=False) & Q(longitude__isnull=False)),
                name="checkin_coordinates_both_or_neither",
            ),
            models.CheckConstraint(
                condition=Q(latitude__isnull=False) | Q(location_accuracy_meters__isnull=True),
                name="checkin_accuracy_requires_coordinates",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.profile_id} at {self.accepted_at.isoformat()}"


class GuardianMembership(UUIDModel):
    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        REVOKED = "revoked", "Revoked"

    profile = models.ForeignKey(CheckInProfile, on_delete=models.CASCADE, related_name="guardians")
    guardian = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="watched_memberships"
    )
    status = models.CharField(max_length=16, choices=Status, default=Status.ACTIVE)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["profile", "guardian"], name="unique_guardian_per_profile"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.guardian_id} watches {self.profile_id}"


class GuardianInvitation(UUIDModel):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        ACCEPTED = "accepted", "Accepted"
        REVOKED = "revoked", "Revoked"
        EXPIRED = "expired", "Expired"

    profile = models.ForeignKey(
        CheckInProfile, on_delete=models.CASCADE, related_name="invitations"
    )
    invited_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    email = models.EmailField()
    normalized_email = models.EmailField(editable=False)
    token_digest = models.CharField(max_length=64, unique=True, editable=False)
    expires_at = models.DateTimeField()
    status = models.CharField(max_length=16, choices=Status, default=Status.PENDING)
    accepted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="accepted_guardian_invitations",
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["profile", "normalized_email"],
                condition=Q(status="pending"),
                name="unique_pending_invitation",
            )
        ]

    def __str__(self) -> str:
        return f"{self.normalized_email} for {self.profile_id}"

    def save(self, *args, **kwargs):
        self.normalized_email = self.email.strip().lower()
        super().save(*args, **kwargs)


class AlertIncident(UUIDModel):
    class Status(models.TextChoices):
        OPEN = "open", "Open"
        RESOLVED = "resolved", "Resolved"

    profile = models.ForeignKey(CheckInProfile, on_delete=models.CASCADE, related_name="incidents")
    deadline_generation = models.PositiveBigIntegerField()
    deadline_at = models.DateTimeField()
    opened_at = models.DateTimeField(default=timezone.now)
    resolved_at = models.DateTimeField(null=True, blank=True)
    resolved_by_check_in = models.ForeignKey(
        CheckIn,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="resolved_incidents",
    )
    status = models.CharField(max_length=16, choices=Status, default=Status.OPEN)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["profile", "deadline_generation"], name="unique_incident_generation"
            ),
            models.UniqueConstraint(
                fields=["profile"],
                condition=Q(status="open"),
                name="unique_open_incident_per_profile",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.profile_id} generation {self.deadline_generation}"


class AlertRecipient(UUIDModel):
    incident = models.ForeignKey(AlertIncident, on_delete=models.CASCADE, related_name="recipients")
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="alert_recipient_snapshots",
    )
    user_id_snapshot = models.UUIDField()

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["incident", "user_id_snapshot"],
                name="unique_alert_recipient_snapshot",
            )
        ]

    def __str__(self) -> str:
        return f"{self.user_id_snapshot} for {self.incident_id}"


class AlertAcknowledgement(UUIDModel):
    incident = models.ForeignKey(
        AlertIncident, on_delete=models.CASCADE, related_name="acknowledgements"
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
    )
    user_id_snapshot = models.UUIDField(editable=False)
    acknowledged_at = models.DateTimeField(default=timezone.now)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["incident", "user_id_snapshot"],
                name="unique_incident_acknowledgement_snapshot",
            )
        ]

    def __str__(self) -> str:
        return f"{self.user_id_snapshot} acknowledged {self.incident_id}"

    def save(self, *args, **kwargs):
        if self.user_id_snapshot is None and self.user_id is not None:
            self.user_id_snapshot = self.user_id
            if kwargs.get("update_fields") is not None:
                kwargs["update_fields"] = {*kwargs["update_fields"], "user_id_snapshot"}
        super().save(*args, **kwargs)


class PushDevice(UUIDModel):
    class Platform(models.TextChoices):
        IOS = "ios", "iOS"
        ANDROID = "android", "Android"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="devices"
    )
    installation_id = models.UUIDField(unique=True)
    expo_push_token = models.CharField(max_length=255, unique=True)
    platform = models.CharField(max_length=16, choices=Platform)
    active = models.BooleanField(default=True)
    last_seen_at = models.DateTimeField(default=timezone.now)

    def __str__(self) -> str:
        return f"{self.platform} installation {self.installation_id}"


class DeliveryAttempt(UUIDModel):
    class Status(models.TextChoices):
        QUEUED = "queued", "Queued"
        TICKET_RECEIVED = "ticket_received", "Ticket received"
        RECEIPT_PROCESSING = "receipt_processing", "Receipt processing"
        LEGACY_DELIVERED = "delivered", "Legacy provider accepted"
        PROVIDER_ACCEPTED = "provider_accepted", "Accepted by APNs/FCM"
        RETRYABLE_FAILURE = "retryable_failure", "Retryable failure"
        PERMANENT_FAILURE = "permanent_failure", "Permanent failure"
        DEAD_LETTER = "dead_letter", "Dead letter"

    incident = models.ForeignKey(AlertIncident, on_delete=models.CASCADE, related_name="deliveries")
    outbox_event = models.ForeignKey(
        "OutboxEvent",
        on_delete=models.PROTECT,
        related_name="delivery_attempts",
        null=True,
        blank=True,
    )
    device = models.ForeignKey(
        PushDevice,
        on_delete=models.SET_NULL,
        related_name="deliveries",
        null=True,
        blank=True,
    )
    device_id_snapshot = models.UUIDField(null=True, blank=True)
    destination_token_hash = models.CharField(max_length=64, blank=True)
    platform_snapshot = models.CharField(max_length=16, blank=True)
    attempt_number = models.PositiveSmallIntegerField(default=1)
    status = models.CharField(max_length=32, choices=Status, default=Status.QUEUED)
    expo_ticket_id = models.CharField(max_length=128, blank=True, db_index=True)
    response_data = models.JSONField(default=dict, blank=True)
    next_retry_at = models.DateTimeField(null=True, blank=True)
    account_erasure_tombstone = models.BooleanField(default=False, db_index=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["outbox_event", "device_id_snapshot", "attempt_number"],
                condition=Q(outbox_event__isnull=False, device_id_snapshot__isnull=False),
                name="unique_event_device_delivery_attempt",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.incident_id} attempt {self.attempt_number}"


class OutboxEvent(UUIDModel):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        PROCESSING = "processing", "Processing"
        PROCESSED = "processed", "Processed"
        FAILED = "failed", "Failed"

    event_type = models.CharField(max_length=80)
    aggregate_type = models.CharField(max_length=80)
    aggregate_id = models.UUIDField()
    deduplication_key = models.CharField(max_length=255, unique=True)
    payload = models.JSONField(default=dict)
    status = models.CharField(max_length=16, choices=Status, default=Status.PENDING, db_index=True)
    attempts = models.PositiveSmallIntegerField(default=0)
    available_at = models.DateTimeField(default=timezone.now, db_index=True)
    locked_at = models.DateTimeField(null=True, blank=True)
    processed_at = models.DateTimeField(null=True, blank=True)
    last_error = models.TextField(blank=True)

    def __str__(self) -> str:
        return f"{self.event_type}: {self.deduplication_key}"


class WorkerHeartbeat(models.Model):
    worker_name = models.CharField(max_length=80, primary_key=True)
    last_seen_at = models.DateTimeField(default=timezone.now, db_index=True)
    details = models.JSONField(default=dict, blank=True)

    def __str__(self) -> str:
        return f"{self.worker_name} at {self.last_seen_at.isoformat()}"


class AuditEvent(models.Model):
    class ActorKind(models.TextChoices):
        USER = "user", "User"
        SYSTEM = "system", "System"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    occurred_at = models.DateTimeField(default=timezone.now, db_index=True, editable=False)
    event_type = models.CharField(max_length=80, db_index=True, editable=False)
    actor_kind = models.CharField(max_length=16, choices=ActorKind, editable=False)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="audit_events",
        editable=False,
    )
    aggregate_type = models.CharField(max_length=80, db_index=True, editable=False)
    aggregate_id = models.UUIDField(db_index=True, editable=False)
    metadata = models.JSONField(default=dict, blank=True, editable=False)

    objects = ImmutableAuditEventQuerySet.as_manager()

    class Meta:
        ordering = ["occurred_at", "id"]
        indexes = [
            models.Index(fields=["aggregate_type", "aggregate_id", "occurred_at"]),
        ]

    def __str__(self) -> str:
        return f"{self.event_type}: {self.aggregate_type}/{self.aggregate_id}"

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise TypeError("Audit events are immutable.")
        from .audit import validate_audit_metadata

        validate_audit_metadata(self.metadata)
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise TypeError("Audit events are immutable.")
