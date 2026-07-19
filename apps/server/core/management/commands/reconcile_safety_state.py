import json

from django.core.management.base import BaseCommand, CommandError

from core.reconciliation import reconcile_domain_state


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

    def handle(self, *args, **options):
        detected = reconcile_domain_state(repair=options["repair"])
        remaining = reconcile_domain_state(repair=False) if options["repair"] else detected
        result = {
            "mode": "repair" if options["repair"] else "detect",
            "detected": detected.as_dict(),
            "remaining": remaining.as_dict(),
        }
        rendered = json.dumps(result, sort_keys=True)
        if options["fail_on_gaps"] and remaining.issues:
            raise CommandError(rendered)
        self.stdout.write(rendered)
