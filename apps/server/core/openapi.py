from rest_framework import serializers


class AcceptedResponseSerializer(serializers.Serializer):
    detail = serializers.CharField()
    verification_required = serializers.BooleanField()


class DetailResponseSerializer(serializers.Serializer):
    detail = serializers.CharField()


class VerificationResultSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=("verified", "already_verified", "invalid", "expired"))


class LogoutRequestSerializer(serializers.Serializer):
    refresh = serializers.CharField(write_only=True)


class LastKnownLocationSchemaSerializer(serializers.Serializer):
    latitude = serializers.DecimalField(max_digits=9, decimal_places=6)
    longitude = serializers.DecimalField(max_digits=9, decimal_places=6)
    accuracy_meters = serializers.DecimalField(
        max_digits=10,
        decimal_places=2,
        allow_null=True,
    )
    recorded_at = serializers.DateTimeField()
    is_live = serializers.BooleanField()


class DeliveryAttemptCountsSchemaSerializer(serializers.Serializer):
    queued = serializers.IntegerField(min_value=0, required=False)
    ticket_received = serializers.IntegerField(min_value=0, required=False)
    receipt_processing = serializers.IntegerField(min_value=0, required=False)
    provider_accepted = serializers.IntegerField(
        min_value=0,
        required=False,
        help_text=("APNs/FCM accepted the notification. This does not prove delivery to a device."),
    )
    retryable_failure = serializers.IntegerField(min_value=0, required=False)
    permanent_failure = serializers.IntegerField(min_value=0, required=False)
    dead_letter = serializers.IntegerField(min_value=0, required=False)


class DeliveryStatusSchemaSerializer(serializers.Serializer):
    state = serializers.ChoiceField(
        choices=(
            "no_delivery_record",
            "pending",
            "sent_to_provider",
            "accepted_by_push_service",
            "failed",
        )
    )
    attempt_counts = DeliveryAttemptCountsSchemaSerializer()


class StatisticsPeriodSchemaSerializer(serializers.Serializer):
    from_time = serializers.DateTimeField(allow_null=True)
    to = serializers.DateTimeField(allow_null=True)

    def get_fields(self):
        fields = super().get_fields()
        fields["from"] = fields.pop("from_time")
        return fields


class StatisticsDefinitionsSchemaSerializer(serializers.Serializer):
    total_check_ins = serializers.CharField()
    on_time_check_ins = serializers.CharField()
    incident_count = serializers.CharField()


class CheckInStatisticsSchemaSerializer(serializers.Serializer):
    period = StatisticsPeriodSchemaSerializer()
    total_check_ins = serializers.IntegerField(min_value=0)
    on_time_check_ins = serializers.IntegerField(min_value=0)
    incident_count = serializers.IntegerField(min_value=0)
    definitions = StatisticsDefinitionsSchemaSerializer()


class ProfileTimelineDetailsSchemaSerializer(serializers.Serializer):
    check_in_id = serializers.UUIDField(required=False)
    incident_id = serializers.UUIDField(required=False)
    resolved_by_check_in_id = serializers.UUIDField(required=False)
    deadline_generation = serializers.IntegerField(min_value=0, required=False)
    next_deadline_at = serializers.DateTimeField(required=False, allow_null=True)
    deadline_at = serializers.DateTimeField(required=False)
    resolved_at = serializers.DateTimeField(required=False, allow_null=True)
    submitted_from_queue = serializers.BooleanField(required=False)
    has_location = serializers.BooleanField(
        required=False,
        help_text="Presence only. Timeline responses never include coordinates.",
    )
    resolved_incident_count = serializers.IntegerField(min_value=0, required=False)
    automatic = serializers.BooleanField(required=False)
    has_scheduled_resume = serializers.BooleanField(required=False)
    revoked_membership_count = serializers.IntegerField(min_value=0, required=False)
    revoked_invitation_count = serializers.IntegerField(min_value=0, required=False)
    enabled = serializers.BooleanField(required=False)
    is_paused = serializers.BooleanField(required=False)
    interval_seconds = serializers.IntegerField(min_value=0, required=False)


class ProfileTimelineEventSchemaSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    event_type = serializers.ChoiceField(
        choices=(
            "profile.created",
            "profile.paused",
            "profile.resumed",
            "profile.archived",
            "checkin.confirmed",
            "incident.opened",
            "incident.resolved",
        )
    )
    occurred_at = serializers.DateTimeField()
    profile_id = serializers.UUIDField()
    details = ProfileTimelineDetailsSchemaSerializer()


class ProfileTimelinePageSchemaSerializer(serializers.Serializer):
    next = serializers.URLField(allow_null=True)
    previous = serializers.URLField(allow_null=True)
    results = ProfileTimelineEventSchemaSerializer(many=True)


class ProfileArchiveConflictSchemaSerializer(serializers.Serializer):
    code = serializers.ChoiceField(choices=("profile_has_open_incident",))
    detail = serializers.CharField()
    incident_id = serializers.UUIDField()


class MobilePlatformReleaseSchemaSerializer(serializers.Serializer):
    min_version = serializers.CharField()
    min_build = serializers.IntegerField(min_value=1)
    store_url = serializers.URLField()


class MobilePlatformsSchemaSerializer(serializers.Serializer):
    ios = MobilePlatformReleaseSchemaSerializer()
    android = MobilePlatformReleaseSchemaSerializer()


class MobileClientConfigSchemaSerializer(serializers.Serializer):
    client = serializers.ChoiceField(choices=("hlasimse-mobile",))
    maintenance = serializers.BooleanField()
    platforms = MobilePlatformsSchemaSerializer()
