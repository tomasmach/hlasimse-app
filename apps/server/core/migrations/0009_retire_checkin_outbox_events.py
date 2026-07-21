from django.db import migrations
from django.utils import timezone


def retire_legacy_checkin_events(apps, schema_editor):
    OutboxEvent = apps.get_model("core", "OutboxEvent")
    now = timezone.now()
    OutboxEvent.objects.filter(
        event_type="checkin.accepted",
        status__in=["pending", "processing"],
    ).update(
        status="processed",
        processed_at=now,
        locked_at=None,
        last_error="Retired legacy no-op event; check-in remains in audit history",
        updated_at=now,
    )


class Migration(migrations.Migration):
    dependencies = [("core", "0008_rename_delivery_receipt_status")]

    operations = [migrations.RunPython(retire_legacy_checkin_events, migrations.RunPython.noop)]
