import json

from django.core.management.base import BaseCommand, CommandError

from core.push import record_worker_heartbeat
from core.reconciliation import reconcile_domain_state
from core.worker_runtime import graceful_stop_signals


class Command(BaseCommand):
    help = (
        "Detect safety-state gaps. Read-only by default; --repair only materializes an "
        "unambiguous expired generation, recreates missing outbox events from incident "
        "snapshots, and restores recipient snapshots from an existing opened-event payload. "
        "It never closes incidents or chooses between conflicting histories."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--repair",
            action="store_true",
            help="Apply only the conservative deterministic repairs documented above.",
        )
        parser.add_argument(
            "--fail-on-gaps",
            action="store_true",
            help="Exit non-zero when gaps remain after the optional repair pass.",
        )
        parser.add_argument("--watch", action="store_true")
        parser.add_argument("--poll-interval", type=float, default=60.0)

    def handle(self, *args, **options):
        with graceful_stop_signals() as stop:
            while not stop.requested:
                detected = reconcile_domain_state(repair=options["repair"])
                remaining = reconcile_domain_state(repair=False) if options["repair"] else detected
                result = {
                    "mode": "repair" if options["repair"] else "detect",
                    "detected": detected.as_dict(),
                    "remaining": remaining.as_dict(),
                }
                rendered = json.dumps(result, sort_keys=True)
                record_worker_heartbeat(
                    "safety_reconciliation",
                    healthy=not remaining.issues,
                    issue_count=len(remaining.issues),
                    repair_count=len(detected.repairs),
                    issues_by_code=remaining.as_dict()["issues_by_code"],
                )
                if options["fail_on_gaps"] and remaining.issues and not options["watch"]:
                    raise CommandError(rendered)
                self.stdout.write(rendered)
                if not options["watch"]:
                    break
                stop.wait(max(options["poll_interval"], 1.0))
