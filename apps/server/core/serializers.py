from datetime import timedelta

from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, transaction
from django.utils import timezone
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from .audit import record_audit_event
from .legal_documents import require_configured_legal_documents
from .models import (
    AlertAcknowledgement,
    AlertIncident,
    CheckIn,
    CheckInProfile,
    GuardianInvitation,
    GuardianMembership,
    PushDevice,
    validate_paused_until_horizon,
)
from .openapi import DeliveryStatusSchemaSerializer, LastKnownLocationSchemaSerializer
from .services import (
    can_acknowledge_incident,
    create_profile,
    update_profile,
    visible_incident_last_known_check_in,
)


class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=10, trim_whitespace=False)
    terms_accepted = serializers.BooleanField(write_only=True)

    class Meta:
        model = get_user_model()
        fields = ("id", "email", "password", "first_name", "last_name", "terms_accepted")
        read_only_fields = ("id",)
        extra_kwargs = {"email": {"validators": []}}

    def validate_email(self, value):
        return value.strip().lower()

    def validate_password(self, value):
        validate_password(value)
        return value

    def validate_terms_accepted(self, value):
        if not value:
            raise serializers.ValidationError(
                "Pro vytvoření účtu je nutné přijmout podmínky používání."
            )
        return value

    def create(self, validated_data):
        legal_documents = require_configured_legal_documents()
        validated_data.pop("terms_accepted")
        validated_data["terms_accepted_at"] = timezone.now()
        validated_data["terms_version"] = legal_documents.terms.version
        try:
            with transaction.atomic():
                return get_user_model().objects.create_user(**validated_data)
        except IntegrityError as exc:
            raise serializers.ValidationError(
                {"email": "Účet s tímto e-mailem už existuje."}
            ) from exc


class EmailVerificationRequestSerializer(serializers.Serializer):
    email = serializers.EmailField(write_only=True)

    def validate_email(self, value):
        return value.strip().lower()


class EmailVerificationConfirmSerializer(serializers.Serializer):
    token = serializers.CharField(write_only=True, max_length=1024, trim_whitespace=False)


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = get_user_model()
        fields = (
            "id",
            "email",
            "first_name",
            "last_name",
            "date_joined",
            "email_verified_at",
        )
        read_only_fields = ("id", "email", "date_joined", "email_verified_at")

    def validate_first_name(self, value):
        return value.strip()

    def validate_last_name(self, value):
        return value.strip()


class AccountDeleteSerializer(serializers.Serializer):
    password = serializers.CharField(write_only=True, trim_whitespace=False)
    confirmed = serializers.BooleanField()

    def validate_confirmed(self, value):
        if value is not True:
            raise serializers.ValidationError("Odstranění účtu musí být výslovně potvrzeno.")
        return value

    def validate_password(self, value):
        if not self.context["request"].user.check_password(value):
            raise serializers.ValidationError("Heslo není správné.")
        return value


class PasswordResetRequestSerializer(serializers.Serializer):
    email = serializers.EmailField(write_only=True)

    def validate_email(self, value):
        return value.strip().lower()


class PasswordResetConfirmSerializer(serializers.Serializer):
    uid = serializers.CharField(write_only=True, max_length=256)
    token = serializers.CharField(write_only=True, max_length=256)
    new_password = serializers.CharField(write_only=True, trim_whitespace=False)

    def validate_new_password(self, value):
        user = self.context.get("user")
        validate_password(value, user=user)
        return value


class ProfileSerializer(serializers.ModelSerializer):
    paused_until = serializers.DateTimeField(
        required=False,
        allow_null=True,
        help_text=(
            "Volitelný vlastní čas automatického obnovení, nejvýše 366 dní od aktuálního "
            "serverového času. Null znamená pauzu do ručního obnovení."
        ),
    )
    pause_duration_seconds = serializers.ChoiceField(
        choices=(86_400, 604_800),
        required=False,
        write_only=True,
    )

    class Meta:
        model = CheckInProfile
        fields = (
            "id",
            "name",
            "interval_seconds",
            "enabled",
            "is_paused",
            "paused_until",
            "pause_duration_seconds",
            "last_checked_in_at",
            "next_deadline_at",
            "deadline_generation",
            "archived_at",
            "created_at",
            "updated_at",
        )
        read_only_fields = (
            "id",
            "last_checked_in_at",
            "next_deadline_at",
            "deadline_generation",
            "archived_at",
            "created_at",
            "updated_at",
        )

    def validate(self, attrs):
        attrs = super().validate(attrs)
        try:
            validate_paused_until_horizon(attrs.get("paused_until"), now=timezone.now())
        except DjangoValidationError as exc:
            raise serializers.ValidationError(exc.message_dict) from exc
        duration = attrs.get("pause_duration_seconds")
        if duration is None:
            return attrs
        if "paused_until" in attrs:
            raise serializers.ValidationError(
                {
                    "pause_duration_seconds": (
                        "Délku pauzy a přesný čas obnovení nelze poslat současně."
                    )
                }
            )
        paused = attrs.get("is_paused", self.instance.is_paused if self.instance else False)
        if not paused:
            raise serializers.ValidationError(
                {"pause_duration_seconds": "Délku lze nastavit jen při aktivaci pauzy."}
            )
        return attrs

    @staticmethod
    def _resolve_pause_duration(validated_data):
        duration = validated_data.pop("pause_duration_seconds", None)
        if duration is not None:
            validated_data["paused_until"] = timezone.now() + timedelta(seconds=duration)
        return validated_data

    def create(self, validated_data):
        validated_data = self._resolve_pause_duration(validated_data)
        try:
            return create_profile(owner=self.context["request"].user, **validated_data)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(exc.message_dict) from exc

    def update(self, instance, validated_data):
        validated_data = self._resolve_pause_duration(validated_data)
        try:
            return update_profile(profile=instance, values=validated_data)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(exc.message_dict) from exc


class ArchivedProfilePageSerializer(serializers.Serializer):
    next = serializers.URLField(allow_null=True)
    previous = serializers.URLField(allow_null=True)
    results = ProfileSerializer(many=True, read_only=True)


class CheckInInputSerializer(serializers.Serializer):
    idempotency_key = serializers.CharField(max_length=128, required=False)
    client_recorded_at = serializers.DateTimeField(required=False, allow_null=True)
    submitted_from_queue = serializers.BooleanField(required=False, default=False)
    latitude = serializers.DecimalField(
        max_digits=9, decimal_places=6, min_value=-90, max_value=90, required=False
    )
    longitude = serializers.DecimalField(
        max_digits=9, decimal_places=6, min_value=-180, max_value=180, required=False
    )
    location_accuracy_meters = serializers.DecimalField(
        max_digits=10,
        decimal_places=2,
        min_value=0,
        max_value=1_000_000,
        required=False,
    )

    def validate(self, attrs):
        if ("latitude" in attrs) != ("longitude" in attrs):
            raise serializers.ValidationError("Souřadnice musí obsahovat šířku i délku.")
        if "location_accuracy_meters" in attrs and "latitude" not in attrs:
            raise serializers.ValidationError(
                {"location_accuracy_meters": "Přesnost vyžaduje souřadnice."}
            )
        return attrs


class CheckInReceiptSerializer(serializers.ModelSerializer):
    next_deadline_at = serializers.DateTimeField(source="response_deadline_at", allow_null=True)

    class Meta:
        model = CheckIn
        fields = (
            "id",
            "idempotency_key",
            "accepted_at",
            "deadline_generation",
            "next_deadline_at",
            "submitted_from_queue",
        )


class CheckInHistorySerializer(serializers.ModelSerializer):
    profile_id = serializers.UUIDField(read_only=True)
    profile_name = serializers.CharField(source="profile.name", read_only=True)
    has_location = serializers.SerializerMethodField()
    server_confirmed = serializers.SerializerMethodField()
    resolved_incident_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = CheckIn
        fields = (
            "id",
            "profile_id",
            "profile_name",
            "accepted_at",
            "client_recorded_at",
            "deadline_generation",
            "response_deadline_at",
            "submitted_from_queue",
            "has_location",
            "server_confirmed",
            "resolved_incident_count",
        )
        read_only_fields = fields

    @extend_schema_field(OpenApiTypes.BOOL)
    def get_server_confirmed(self, obj):
        return True

    @extend_schema_field(OpenApiTypes.BOOL)
    def get_has_location(self, obj):
        return obj.latitude is not None and obj.longitude is not None


class GuardianSerializer(serializers.ModelSerializer):
    email = serializers.EmailField(source="guardian.email", read_only=True)
    display_name = serializers.SerializerMethodField()

    class Meta:
        model = GuardianMembership
        fields = ("id", "email", "display_name", "status", "created_at")
        read_only_fields = fields

    @extend_schema_field(OpenApiTypes.STR)
    def get_display_name(self, obj):
        return f"{obj.guardian.first_name} {obj.guardian.last_name}".strip()


class InvitationSerializer(serializers.ModelSerializer):
    class Meta:
        model = GuardianInvitation
        fields = ("id", "email", "status", "expires_at", "created_at")
        read_only_fields = fields


class ReceivedInvitationSerializer(serializers.ModelSerializer):
    profile_id = serializers.UUIDField(read_only=True)
    profile_name = serializers.CharField(source="profile.name", read_only=True)
    owner_display_name = serializers.SerializerMethodField()

    class Meta:
        model = GuardianInvitation
        fields = (
            "id",
            "profile_id",
            "profile_name",
            "owner_display_name",
            "status",
            "expires_at",
            "created_at",
        )
        read_only_fields = fields

    @extend_schema_field(OpenApiTypes.STR)
    def get_owner_display_name(self, obj):
        owner = obj.profile.owner
        return f"{owner.first_name} {owner.last_name}".strip() or "Uživatel"


class InvitationDecisionSerializer(serializers.Serializer):
    decision = serializers.ChoiceField(choices=("accept", "decline"))


class InvitationCreateSerializer(serializers.Serializer):
    email = serializers.EmailField()


class InvitationAcceptSerializer(serializers.Serializer):
    token = serializers.CharField(min_length=20, max_length=200)


class WatchedProfileSerializer(serializers.ModelSerializer):
    owner_display_name = serializers.SerializerMethodField()
    open_alert_count = serializers.SerializerMethodField()
    membership_id = serializers.SerializerMethodField()

    class Meta:
        model = CheckInProfile
        fields = (
            "id",
            "name",
            "owner_display_name",
            "enabled",
            "is_paused",
            "paused_until",
            "last_checked_in_at",
            "next_deadline_at",
            "deadline_generation",
            "open_alert_count",
            "membership_id",
        )
        read_only_fields = fields

    @extend_schema_field(OpenApiTypes.STR)
    def get_owner_display_name(self, obj):
        return f"{obj.owner.first_name} {obj.owner.last_name}".strip() or "Uživatel"

    @extend_schema_field(OpenApiTypes.INT)
    def get_open_alert_count(self, obj):
        return obj.incidents.filter(status=AlertIncident.Status.OPEN).count()

    @extend_schema_field({"type": "string", "format": "uuid", "nullable": True})
    def get_membership_id(self, obj):
        request = self.context.get("request")
        if request is None or not request.user.is_authenticated:
            return None
        return (
            obj.guardians.filter(
                guardian=request.user,
                status=GuardianMembership.Status.ACTIVE,
            )
            .values_list("id", flat=True)
            .first()
        )


class PushDeviceSerializer(serializers.ModelSerializer):
    MAX_ACTIVE_DEVICES_PER_USER = 5

    class Meta:
        model = PushDevice
        fields = (
            "id",
            "installation_id",
            "expo_push_token",
            "platform",
            "active",
            "last_seen_at",
        )
        read_only_fields = ("id", "active", "last_seen_at")
        extra_kwargs = {
            "installation_id": {"validators": []},
            "expo_push_token": {"validators": [], "write_only": True},
        }

    def create(self, validated_data):
        user = self.context["request"].user
        installation_id = validated_data.pop("installation_id")
        submitted_token = validated_data["expo_push_token"]
        with transaction.atomic():
            # Serialize registrations for one account so concurrent requests cannot
            # both observe a free slot and exceed the active-device limit.
            user = get_user_model().objects.select_for_update().get(pk=user.pk)
            device = (
                PushDevice.objects.select_for_update()
                .filter(installation_id=installation_id)
                .first()
            )
            token_device = (
                PushDevice.objects.select_for_update()
                .filter(expo_push_token=submitted_token)
                .first()
            )
            was_active = device.active if device is not None else False
            previous_user_id = device.user_id if device is not None else None
            if token_device is not None and (device is None or token_device.pk != device.pk):
                raise serializers.ValidationError(
                    {"expo_push_token": "Push token už patří jiné instalaci."}
                )
            already_active_for_user = (
                device is not None and device.user_id == user.id and device.active
            )
            if (
                not already_active_for_user
                and PushDevice.objects.filter(user=user, active=True).count()
                >= self.MAX_ACTIVE_DEVICES_PER_USER
            ):
                raise serializers.ValidationError(
                    {
                        "non_field_errors": [
                            "Účet už má maximální počet 5 aktivních zařízení. "
                            "Nejprve odstraňte některé starší zařízení."
                        ]
                    }
                )
            if device is not None and device.user_id != user.id:
                # Rebinding requires both installation UUID and its current provider token.
                if device.expo_push_token != submitted_token:
                    raise serializers.ValidationError(
                        {"installation_id": "Instalaci nelze bezpečně převázat."}
                    )
                device.user = user
            if device is None:
                try:
                    with transaction.atomic():
                        device = PushDevice.objects.create(
                            user=user,
                            installation_id=installation_id,
                            **validated_data,
                        )
                except IntegrityError as exc:
                    raise serializers.ValidationError(
                        {"installation_id": "Instalaci nelze bezpečně zaregistrovat."}
                    ) from exc
            else:
                device.expo_push_token = submitted_token
                device.platform = validated_data["platform"]
                device.active = True
                device.last_seen_at = timezone.now()
                device.save(
                    update_fields=[
                        "user",
                        "expo_push_token",
                        "platform",
                        "active",
                        "last_seen_at",
                        "updated_at",
                    ]
                )
            if not was_active or previous_user_id != user.id:
                record_audit_event(
                    event_type="device.activated",
                    aggregate_type="push_device",
                    aggregate_id=device.id,
                    actor=user,
                    metadata={
                        "platform": device.platform,
                        "rebound": previous_user_id is not None and previous_user_id != user.id,
                    },
                )
        return device


class AcknowledgementSerializer(serializers.ModelSerializer):
    user_id = serializers.UUIDField(source="user_id_snapshot", read_only=True)
    display_name = serializers.SerializerMethodField()

    class Meta:
        model = AlertAcknowledgement
        fields = ("user_id", "display_name", "acknowledged_at")

    @extend_schema_field(OpenApiTypes.STR)
    def get_display_name(self, obj):
        if obj.user is None:
            return "Smazaný strážce"
        return (
            " ".join(part for part in (obj.user.first_name, obj.user.last_name) if part).strip()
            or "Strážce"
        )


class AlertIncidentSerializer(serializers.ModelSerializer):
    profile_id = serializers.UUIDField(read_only=True)
    profile_name = serializers.CharField(source="profile.name", read_only=True)
    acknowledgements = serializers.SerializerMethodField()
    last_known_location = serializers.SerializerMethodField()
    delivery_status = serializers.SerializerMethodField()
    can_acknowledge = serializers.SerializerMethodField()

    class Meta:
        model = AlertIncident
        fields = (
            "id",
            "profile_id",
            "profile_name",
            "deadline_generation",
            "deadline_at",
            "opened_at",
            "resolved_at",
            "status",
            "acknowledgements",
            "last_known_location",
            "delivery_status",
            "can_acknowledge",
        )
        read_only_fields = fields

    @extend_schema_field(OpenApiTypes.BOOL)
    def get_can_acknowledge(self, obj):
        request = self.context.get("request")
        return bool(request is not None and can_acknowledge_incident(request.user, obj))

    @extend_schema_field(AcknowledgementSerializer(many=True))
    def get_acknowledgements(self, obj):
        acknowledgements = getattr(obj, "ordered_acknowledgements", None)
        if acknowledgements is None:
            acknowledgements = obj.acknowledgements.select_related("user").order_by(
                "acknowledged_at", "id"
            )
        return AcknowledgementSerializer(acknowledgements, many=True).data

    @extend_schema_field(LastKnownLocationSchemaSerializer(allow_null=True))
    def get_last_known_location(self, obj):
        request = self.context.get("request")
        if request is None:
            return None
        check_in = visible_incident_last_known_check_in(
            user=request.user,
            incident=obj,
        )
        if check_in is None:
            return None
        return {
            "latitude": str(check_in.latitude),
            "longitude": str(check_in.longitude),
            "accuracy_meters": (
                str(check_in.location_accuracy_meters)
                if check_in.location_accuracy_meters is not None
                else None
            ),
            "recorded_at": check_in.accepted_at,
            "is_live": False,
        }

    @extend_schema_field(DeliveryStatusSchemaSerializer)
    def get_delivery_status(self, obj):
        request = self.context.get("request")
        attempts = obj.deliveries.all()
        if request is not None and obj.profile.owner_id != request.user.id:
            attempts = attempts.filter(device__user=request.user)
        counts = {
            value: attempts.filter(status=value).count()
            for value, _label in obj.deliveries.model.Status.choices
        }
        counts = {key: value for key, value in counts.items() if value}
        legacy_provider_accepted = counts.pop("delivered", 0)
        if legacy_provider_accepted:
            counts["provider_accepted"] = (
                counts.get("provider_accepted", 0) + legacy_provider_accepted
            )
        if not counts:
            state = "no_delivery_record"
        elif counts.get("provider_accepted"):
            state = "accepted_by_push_service"
        elif counts.get("ticket_received") or counts.get("receipt_processing"):
            state = "sent_to_provider"
        elif counts.get("queued") or counts.get("retryable_failure"):
            state = "pending"
        else:
            state = "failed"
        return {"state": state, "attempt_counts": counts}
