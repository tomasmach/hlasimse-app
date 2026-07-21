from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from .models import (
    AlertIncident,
    CheckInProfile,
    DeliveryAttempt,
    EmailVerificationChallenge,
    GuardianInvitation,
    GuardianMembership,
    OutboxEvent,
    PushDevice,
    User,
)


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    ordering = ("email",)
    list_display = ("email", "email_verified_at", "is_active", "is_staff")
    fieldsets = (
        (None, {"fields": ("email", "password")}),
        ("Personal", {"fields": ("first_name", "last_name", "email_verified_at")}),
        ("Permissions", {"fields": ("is_active", "is_staff", "is_superuser")}),
    )
    add_fieldsets = (
        (None, {"fields": ("email", "password1", "password2", "is_staff", "is_active")}),
    )
    search_fields = ("email",)


admin.site.register(CheckInProfile)
admin.site.register(GuardianMembership)
admin.site.register(GuardianInvitation)
admin.site.register(AlertIncident)
admin.site.register(PushDevice)
admin.site.register(DeliveryAttempt)
admin.site.register(OutboxEvent)
admin.site.register(EmailVerificationChallenge)
