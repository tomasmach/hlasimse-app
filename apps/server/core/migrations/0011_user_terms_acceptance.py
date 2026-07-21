from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("core", "0010_anonymizable_alert_acknowledgements")]

    operations = [
        migrations.AddField(
            model_name="user",
            name="terms_accepted_at",
            field=models.DateTimeField(blank=True, editable=False, null=True),
        ),
        migrations.AddField(
            model_name="user",
            name="terms_version",
            field=models.CharField(blank=True, editable=False, max_length=64),
        ),
        migrations.AddConstraint(
            model_name="user",
            constraint=models.CheckConstraint(
                condition=(
                    models.Q(("terms_accepted_at__isnull", True), ("terms_version", ""))
                    | models.Q(
                        ("terms_accepted_at__isnull", False), ~models.Q(("terms_version", ""))
                    )
                ),
                name="user_terms_acceptance_pair",
            ),
        ),
    ]
