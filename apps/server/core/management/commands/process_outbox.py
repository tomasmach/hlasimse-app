import time

from django.core.management.base import BaseCommand

from core.push import process_one_outbox_event, record_worker_heartbeat


class Command(BaseCommand):
    help = "Consume supported outbox events and send alert notifications through Expo."

    def add_arguments(self, parser):
        parser.add_argument("--limit", type=int, default=100)
        parser.add_argument("--watch", action="store_true")
        parser.add_argument("--poll-interval", type=float, default=2.0)

    def handle(self, *args, **options):
        total = 0
        while True:
            processed = 0
            while processed < options["limit"] and process_one_outbox_event():
                processed += 1
            total += processed
            record_worker_heartbeat("outbox", events_processed=total, idle=processed == 0)
            if not options["watch"]:
                break
            time.sleep(max(options["poll_interval"], 0.1))
        self.stdout.write(f"events_processed={total}")
