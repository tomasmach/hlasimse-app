import json
import uuid

from django.core.management.base import BaseCommand, CommandError

from core.alert_delivery_recovery import (
    AlertDeliveryRecoveryError,
    recover_dead_letter_alert,
)


class Command(BaseCommand):
    help = (
        "Create one audited, idempotent alert.retry event from one exact terminal dead-letter "
        "event. A partially delivered event retries only recipients with no accepted destination. "
        "The source event and its delivery attempts remain immutable."
    )

    def add_arguments(self, parser):
        parser.add_argument("--event-id", type=uuid.UUID, required=True)
        parser.add_argument("--incident-id", type=uuid.UUID, required=True)
        parser.add_argument("--operator-id", type=uuid.UUID, required=True)
        parser.add_argument("--reason", required=True)

    def handle(self, *args, **options):
        try:
            result = recover_dead_letter_alert(
                event_id=options["event_id"],
                incident_id=options["incident_id"],
                operator_id=options["operator_id"],
                reason=options["reason"],
            )
        except AlertDeliveryRecoveryError as exc:
            raise CommandError(str(exc)) from exc

        self.stdout.write(
            json.dumps(
                {
                    "active_recipient_count": result.active_recipient_count,
                    "created": result.created,
                    "retry_event_id": str(result.retry_event.id),
                    "source_event_id": str(options["event_id"]),
                },
                sort_keys=True,
            )
        )
