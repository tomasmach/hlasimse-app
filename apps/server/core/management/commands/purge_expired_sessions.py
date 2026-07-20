from django.contrib.sessions.models import Session
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from core.worker_runtime import graceful_stop_signals

DEFAULT_BATCH_SIZE = 1_000
MAX_BATCH_SIZE = 10_000
DEFAULT_POLL_INTERVAL = 86_400.0
MIN_WATCH_POLL_INTERVAL = 60.0


def purge_expired_sessions(*, cutoff, batch_size: int, stop=None) -> int:
    """Delete only sessions still expired at deletion time, in bounded batches."""
    deleted_total = 0
    while stop is None or not stop.requested:
        session_keys = list(
            Session.objects.filter(expire_date__lte=cutoff)
            .order_by("expire_date", "session_key")
            .values_list("session_key", flat=True)[:batch_size]
        )
        if not session_keys:
            break
        # Recheck expire_date so a concurrently refreshed session selected above is
        # never removed as stale.
        deleted, _details = Session.objects.filter(
            session_key__in=session_keys,
            expire_date__lte=cutoff,
        ).delete()
        deleted_total += deleted
    return deleted_total


class Command(BaseCommand):
    help = "Delete expired Django database sessions without applying domain-data retention."

    def add_arguments(self, parser):
        parser.add_argument("--batch-size", type=int, default=DEFAULT_BATCH_SIZE)
        parser.add_argument("--watch", action="store_true")
        parser.add_argument("--poll-interval", type=float, default=DEFAULT_POLL_INTERVAL)

    def handle(self, *args, **options):
        batch_size = options["batch_size"]
        poll_interval = options["poll_interval"]
        if not 1 <= batch_size <= MAX_BATCH_SIZE:
            raise CommandError(f"--batch-size must be between 1 and {MAX_BATCH_SIZE}")
        if options["watch"] and poll_interval < MIN_WATCH_POLL_INTERVAL:
            raise CommandError(
                f"--poll-interval must be at least {MIN_WATCH_POLL_INTERVAL:g} in watch mode"
            )

        deleted_total = 0
        with graceful_stop_signals() as stop:
            while not stop.requested:
                deleted = purge_expired_sessions(
                    cutoff=timezone.now(),
                    batch_size=batch_size,
                    stop=stop,
                )
                deleted_total += deleted
                self.stdout.write(f"sessions_deleted={deleted}")
                if not options["watch"] or stop.requested:
                    break
                stop.wait(poll_interval)
        self.stdout.write(f"sessions_deleted_total={deleted_total}")
