import json
from datetime import timedelta

from django.core.management.base import BaseCommand, CommandError

from core.health import delivery_health


class Command(BaseCommand):
    help = "Fail unless deadline, outbox, invitation, and push-delivery workers are healthy."

    def add_arguments(self, parser):
        parser.add_argument("--heartbeat-max-age-seconds", type=int, default=300)

    def handle(self, *args, **options):
        health = delivery_health(
            heartbeat_max_age=timedelta(seconds=options["heartbeat_max_age_seconds"])
        )
        rendered = json.dumps(health, sort_keys=True)
        if not health["healthy"]:
            raise CommandError(rendered)
        self.stdout.write(rendered)
