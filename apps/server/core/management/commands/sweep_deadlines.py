from django.core.management.base import BaseCommand

from core.push import record_worker_heartbeat
from core.services import sweep_expired_deadlines
from core.worker_runtime import graceful_stop_signals


class Command(BaseCommand):
    help = "Create one alert incident and outbox event for each expired deadline generation."

    def add_arguments(self, parser):
        parser.add_argument("--limit", type=int, default=500)
        parser.add_argument("--watch", action="store_true")
        parser.add_argument("--poll-interval", type=float, default=15.0)

    def handle(self, *args, **options):
        total_incidents = 0
        total_events = 0
        with graceful_stop_signals() as stop:
            while not stop.requested:
                incidents, events = sweep_expired_deadlines(limit=options["limit"])
                total_incidents += incidents
                total_events += events
                record_worker_heartbeat(
                    "deadline_sweeper",
                    incidents_created=total_incidents,
                    events_created=total_events,
                )
                if not options["watch"] or stop.requested:
                    break
                stop.wait(max(options["poll_interval"], 1.0))
        self.stdout.write(f"incidents_created={total_incidents} events_created={total_events}")
