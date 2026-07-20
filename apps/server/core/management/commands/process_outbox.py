from django.core.management.base import BaseCommand

from core.push import (
    ALERT_EVENT_TYPES,
    EMAIL_EVENT_TYPES,
    PROCESSABLE_EVENT_TYPES,
    process_one_outbox_event,
    record_worker_heartbeat,
)
from core.worker_runtime import graceful_stop_signals

QUEUES = {
    "alert": (ALERT_EVENT_TYPES, "outbox_alerts"),
    "email": (EMAIL_EVENT_TYPES, "outbox_email"),
    "all": (PROCESSABLE_EVENT_TYPES, "outbox"),
}


class Command(BaseCommand):
    help = "Consume supported outbox events and send alert notifications through Expo."

    def add_arguments(self, parser):
        parser.add_argument("--limit", type=int, default=100)
        parser.add_argument("--watch", action="store_true")
        parser.add_argument("--poll-interval", type=float, default=2.0)
        parser.add_argument("--queue", choices=sorted(QUEUES), default="all")

    def handle(self, *args, **options):
        total = 0
        event_types, worker_name = QUEUES[options["queue"]]
        with graceful_stop_signals() as stop:
            while not stop.requested:
                processed = 0
                while processed < options["limit"] and not stop.requested:
                    if not process_one_outbox_event(
                        event_types=event_types,
                        worker_name=worker_name,
                    ):
                        break
                    processed += 1
                total += processed
                record_worker_heartbeat(
                    worker_name,
                    events_processed=total,
                    idle=processed == 0,
                    queue=options["queue"],
                )
                if not options["watch"] or stop.requested:
                    break
                stop.wait(max(options["poll_interval"], 0.1))
        self.stdout.write(f"events_processed={total}")
