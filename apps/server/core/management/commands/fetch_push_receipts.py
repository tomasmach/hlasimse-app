import time

import httpx
from django.core.management.base import BaseCommand

from core.push import fetch_push_receipts, record_worker_heartbeat


class Command(BaseCommand):
    help = "Fetch Expo delivery receipts and schedule retryable failures."

    def add_arguments(self, parser):
        parser.add_argument("--limit", type=int, default=1000)
        parser.add_argument("--watch", action="store_true")
        parser.add_argument("--poll-interval", type=float, default=30.0)
        parser.add_argument("--error-backoff", type=float, default=30.0)
        parser.add_argument("--max-cycles", type=int)

    def handle(self, *args, **options):
        total = 0
        consecutive_errors = 0
        cycles = 0
        while True:
            cycles += 1
            try:
                processed = fetch_push_receipts(limit=options["limit"])
            except (httpx.HTTPError, ValueError) as exc:
                consecutive_errors += 1
                record_worker_heartbeat(
                    "push_receipts",
                    healthy=False,
                    consecutive_errors=consecutive_errors,
                    last_error=str(exc)[:1000],
                )
                if not options["watch"]:
                    raise
                if options["max_cycles"] is not None and cycles >= options["max_cycles"]:
                    break
                delay = min(
                    max(options["error_backoff"], 1.0) * (2 ** (consecutive_errors - 1)),
                    300.0,
                )
                time.sleep(delay)
                continue
            consecutive_errors = 0
            total += processed
            record_worker_heartbeat(
                "push_receipts",
                healthy=True,
                receipts_processed=total,
                consecutive_errors=0,
            )
            if not options["watch"]:
                break
            if options["max_cycles"] is not None and cycles >= options["max_cycles"]:
                break
            time.sleep(max(options["poll_interval"], 1.0))
        self.stdout.write(f"receipts_processed={total}")
