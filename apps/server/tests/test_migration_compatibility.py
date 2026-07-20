import importlib

from django.db import migrations


def test_delivery_status_rename_migration_is_expand_only():
    migration_module = importlib.import_module(
        "core.migrations.0008_rename_delivery_receipt_status"
    )

    assert not any(
        isinstance(operation, migrations.RunPython)
        for operation in migration_module.Migration.operations
    )
    alter_status = next(
        operation
        for operation in migration_module.Migration.operations
        if isinstance(operation, migrations.AlterField) and operation.name == "status"
    )
    choice_values = {value for value, _label in alter_status.field.choices}
    assert {"delivered", "provider_accepted"} <= choice_values
