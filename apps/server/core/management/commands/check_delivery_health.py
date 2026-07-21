import json
from datetime import timedelta

from django.core.management.base import BaseCommand, CommandError

from core.health import delivery_health
from core.worker_runtime import graceful_stop_signals


class Command(BaseCommand):
    help = "Fail unless deadline, outbox, invitation, and push-delivery workers are healthy."

    def add_arguments(self, parser):
        parser.add_argument("--heartbeat-max-age-seconds", type=int, default=300)
        parser.add_argument("--watch", action="store_true")
        parser.add_argument("--poll-interval", type=float, default=30.0)

    def handle(self, *args, **options):
        if options["heartbeat_max_age_seconds"] <= 0:
            raise CommandError("--heartbeat-max-age-seconds must be greater than zero")
        if options["poll_interval"] <= 0:
            raise CommandError("--poll-interval must be greater than zero")
        with graceful_stop_signals() as stop:
            while not stop.requested:
                health = delivery_health(
                    heartbeat_max_age=timedelta(seconds=options["heartbeat_max_age_seconds"])
                )
                rendered = json.dumps(health, sort_keys=True)
                if not health["healthy"]:
                    raise CommandError(rendered)
                self.stdout.write(rendered)
                if not options["watch"] or stop.requested:
                    break
                stop.wait(options["poll_interval"])
