import json
from datetime import timedelta

from django.core.management.base import BaseCommand, CommandError

from core.safety_metrics import safety_metrics_snapshot
from core.worker_runtime import graceful_stop_signals

DEFAULT_POLL_INTERVAL = 30.0
MIN_POLL_INTERVAL = 1.0


class Command(BaseCommand):
    help = (
        "Emit aggregate safety telemetry as newline-delimited JSON without exposing it over HTTP."
    )

    def add_arguments(self, parser):
        parser.add_argument("--watch", action="store_true")
        parser.add_argument("--poll-interval", type=float, default=DEFAULT_POLL_INTERVAL)
        parser.add_argument("--heartbeat-max-age-seconds", type=float, default=300.0)

    def handle(self, *args, **options):
        poll_interval = options["poll_interval"]
        heartbeat_max_age_seconds = options["heartbeat_max_age_seconds"]
        if options["watch"] and poll_interval < MIN_POLL_INTERVAL:
            raise CommandError(
                f"--poll-interval must be at least {MIN_POLL_INTERVAL:g} in watch mode"
            )
        if heartbeat_max_age_seconds <= 0:
            raise CommandError("--heartbeat-max-age-seconds must be greater than zero")

        with graceful_stop_signals() as stop:
            while not stop.requested:
                snapshot = safety_metrics_snapshot(
                    heartbeat_max_age=timedelta(seconds=heartbeat_max_age_seconds)
                )
                self.stdout.write(
                    json.dumps(snapshot, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
                )
                self.stdout.flush()
                if not options["watch"] or stop.requested:
                    break
                stop.wait(poll_interval)
