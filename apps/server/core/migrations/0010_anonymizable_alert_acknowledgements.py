import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


def populate_acknowledgement_snapshots(apps, schema_editor):
    AlertAcknowledgement = apps.get_model("core", "AlertAcknowledgement")
    for acknowledgement in AlertAcknowledgement.objects.filter(
        user_id_snapshot__isnull=True
    ).iterator():
        acknowledgement.user_id_snapshot = acknowledgement.user_id
        acknowledgement.save(update_fields=["user_id_snapshot"])


def remove_anonymous_acknowledgements(apps, schema_editor):
    AlertAcknowledgement = apps.get_model("core", "AlertAcknowledgement")
    AlertAcknowledgement.objects.filter(user_id__isnull=True).delete()


class Migration(migrations.Migration):
    dependencies = [("core", "0009_retire_checkin_outbox_events")]

    operations = [
        migrations.AddField(
            model_name="deliveryattempt",
            name="account_erasure_tombstone",
            field=models.BooleanField(db_index=True, default=False),
        ),
        migrations.AddField(
            model_name="alertacknowledgement",
            name="user_id_snapshot",
            field=models.UUIDField(editable=False, null=True),
        ),
        migrations.RunPython(
            populate_acknowledgement_snapshots,
            migrations.RunPython.noop,
        ),
        migrations.RemoveConstraint(
            model_name="alertacknowledgement",
            name="unique_incident_acknowledgement",
        ),
        migrations.AlterField(
            model_name="alertacknowledgement",
            name="user",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AlterField(
            model_name="alertacknowledgement",
            name="user_id_snapshot",
            field=models.UUIDField(editable=False),
        ),
        migrations.AddConstraint(
            model_name="alertacknowledgement",
            constraint=models.UniqueConstraint(
                fields=("incident", "user_id_snapshot"),
                name="unique_incident_acknowledgement_snapshot",
            ),
        ),
        migrations.RunPython(
            migrations.RunPython.noop,
            remove_anonymous_acknowledgements,
        ),
    ]
