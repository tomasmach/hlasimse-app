import re
from collections.abc import Mapping, Sequence

from django.core.exceptions import ValidationError

from .models import AuditEvent

_FORBIDDEN_KEY_PARTS = {
    "email",
    "password",
    "secret",
    "token",
    "latitude",
    "longitude",
    "coordinate",
    "location",
    "address",
    "name",
}
_EMAIL_LIKE = re.compile(r"[^\s@]+@[^\s@]+")
_SECRET_LIKE = re.compile(
    r"(?:Expo(?:nent)?PushToken\[|Bearer\s+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.)",
    re.IGNORECASE,
)


def validate_audit_metadata(value, *, path: str = "metadata") -> None:
    """Reject values that could place credentials, PII, or coordinates in the audit log."""
    if isinstance(value, Mapping):
        for key, nested in value.items():
            if not isinstance(key, str):
                raise ValidationError(f"{path} keys must be strings.")
            normalized = key.lower().replace("-", "_")
            if any(part in normalized for part in _FORBIDDEN_KEY_PARTS):
                raise ValidationError(f"{path}.{key} is not permitted in audit metadata.")
            validate_audit_metadata(nested, path=f"{path}.{key}")
        return
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        for index, nested in enumerate(value):
            validate_audit_metadata(nested, path=f"{path}[{index}]")
        return
    if value is None or isinstance(value, (bool, int, float)):
        return
    if isinstance(value, str):
        if _EMAIL_LIKE.search(value):
            raise ValidationError(f"{path} must not contain an email address.")
        if _SECRET_LIKE.search(value):
            raise ValidationError(f"{path} must not contain a credential or provider token.")
        if len(value) > 255:
            raise ValidationError(f"{path} is too long for audit metadata.")
        return
    raise ValidationError(f"{path} contains an unsupported value type.")


def record_audit_event(
    *,
    event_type: str,
    aggregate_type: str,
    aggregate_id,
    actor=None,
    metadata: dict | None = None,
) -> AuditEvent:
    safe_metadata = metadata or {}
    validate_audit_metadata(safe_metadata)
    return AuditEvent.objects.create(
        event_type=event_type,
        actor_kind=(
            AuditEvent.ActorKind.USER if actor is not None else AuditEvent.ActorKind.SYSTEM
        ),
        actor=actor,
        aggregate_type=aggregate_type,
        aggregate_id=aggregate_id,
        metadata=safe_metadata,
    )
